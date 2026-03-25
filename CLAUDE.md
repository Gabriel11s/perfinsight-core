# Dashboard Tracker — AI Coding Context

This file is the authoritative reference for any AI assistant working on this codebase.
Read it fully before making any changes.

---

## 1. What This App Does

Dashboard Tracker is a multi-tenant SaaS analytics platform for GoHighLevel (GHL) agencies. It tracks:
- **Page sessions**: which pages GHL users visit inside their GHL dashboard, and for how long
- **Webhook events**: GHL automation events (appointments, contacts, messages, etc.)

Tenants can be **agencies** (with many sub-accounts/locations) or **direct businesses** (single location). A single GHL `location_id` may be shared by multiple tenants simultaneously (e.g., an agency AND a direct business both install the app). This is by design — see Section 6.

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| State | TanStack Query (React Query v5) |
| Auth | Supabase Auth (email/password) |
| Database | Supabase (PostgreSQL) |
| Edge Functions | Deno (Supabase Edge Functions) |
| GHL Integration | GoHighLevel OAuth 2.0 + Webhooks |
| Cron | pg_cron (nightly summary rollups) |

---

## 3. Database Schema (Current, Accurate)

### Core Tables

#### `tenants`
```
id            uuid PK
name          text
mode          text  ('agency' | 'business')
owner_user_id uuid  (auth.users reference)
created_at    timestamptz
```

#### `tenant_members`
```
id         uuid PK
tenant_id  uuid FK → tenants
user_id    uuid FK → auth.users
role       text  ('owner' | 'member')
created_at timestamptz
```
Index: `(user_id)` for fast tenant resolution on auth.

#### `tracker_page_sessions`
```
id               uuid PK
tenant_id        uuid FK → tenants  (filled by BEFORE INSERT trigger)
location_id      text               (GHL sub-account ID, from URL)
user_id          text               (GHL user ID, from JWT cookie)
page_path        text               (pathname + search, e.g. /v2/location/abc/contacts)
started_at       timestamptz
ended_at         timestamptz
duration_seconds integer
heartbeats       integer DEFAULT 0  (count of 15-second active ticks)
details          jsonb              ({end_reason: 'beforeunload'|'route_change'|'visibility_hidden'})
geo_country      text               (from IP geo lookup via tracker-ingest)
geo_region       text
geo_city         text
geo_lat          double precision
geo_lon          double precision
geo_timezone     text
client_timezone  text               (from browser Intl API)
client_locale    text               (from navigator.language)
user_agent       text
screen_width     integer
screen_height    integer
created_at       timestamptz DEFAULT now()
```
**Important**: The tracker script does NOT send `tenant_id`. A BEFORE INSERT trigger fills it.
**Geo data**: Populated by the `tracker-ingest` edge function via IP lookup (ipapi.co / ip-api.com fallback).
Client metadata (timezone, locale, user_agent, screen) is sent by the tracker script.
**Columns that do NOT exist**: `session_id`, `contact_id`, `is_bounce`, `page_views`.
These were removed. Any migration referencing them will fail.

#### `ghl_events`
```
id           uuid PK
tenant_id    uuid FK → tenants  (filled by BEFORE INSERT trigger)
location_id  text NOT NULL
event_type   text NOT NULL
user_id      text
contact_id   text
event_data   jsonb NOT NULL DEFAULT '{}'
event_date   timestamptz NOT NULL
webhook_id   text
created_at   timestamptz DEFAULT now()
```
Dedup index: `UNIQUE (webhook_id, tenant_id) WHERE webhook_id IS NOT NULL AND tenant_id IS NOT NULL`

#### `ghl_oauth_tokens`
```
tenant_id     uuid PK FK → tenants
access_token  text
refresh_token text
expires_at    timestamptz
location_id   text  (NULL for agency tokens — GHL doesn't return this for agency-level OAuth)
company_id    text  (GHL company/agency ID)
updated_at    timestamptz
```
**Note**: `location_id` is NULL for agency-level OAuth grants. This is expected behavior.
The auto_fill triggers use `ghl_cache_locations` as the primary tenant lookup, NOT this table.

#### `ghl_cache_locations`
```
PRIMARY KEY (tenant_id, location_id)  ← composite, multi-tenant
tenant_id      uuid FK → tenants
location_id    text
location_name  text
updated_at     timestamptz
```
This table is the **primary mapping** from `location_id → tenant_id`. It is populated by
the `sync-ghl-names` edge function. All auto-fill triggers depend on it.

#### `ghl_cache_users`
```
PRIMARY KEY (tenant_id, user_id)  ← composite, multi-tenant (fixed in migration 022)
tenant_id  uuid FK → tenants
user_id    text
user_name  text
updated_at timestamptz
```
Each tenant maintains its own independent user name cache.

#### `ghl_event_daily_summary`
```
id            uuid PK
tenant_id     uuid FK → tenants
location_id   text
event_date    date
event_type    text
event_count   integer
user_counts   jsonb  ({userId: count})
sms_count     integer
call_count    integer
email_count   integer
other_msg_count integer
created_at    timestamptz
UNIQUE (tenant_id, location_id, event_date, event_type)
```

#### `tracker_session_daily_summary`
```
id                     uuid PK
tenant_id              uuid FK → tenants
location_id            text
user_id                text
date                   date
page_category          text NOT NULL DEFAULT 'Other'
total_duration_seconds integer
session_count          integer
bounce_count           integer  (sessions where COALESCE(duration_seconds,0) < 10)
created_at             timestamptz
updated_at             timestamptz
UNIQUE (tenant_id, location_id, user_id, date, page_category)
```
Note: "bounce" is `duration_seconds < 10`, NOT an `is_bounce` column (that column does not exist).
`page_category` is computed by `categorize_page_path()` SQL function (mirrors `categorizePagePath()` in helpers.ts).
Rolled up nightly by `upsert_tracker_summary_for_date()` via pg_cron at 1:00 AM UTC.

#### `user_presence`
```
user_id      text NOT NULL
location_id  text NOT NULL
tenant_id    uuid FK → tenants
page_path    text               (current page the user is on)
last_seen_at timestamptz DEFAULT now()
PRIMARY KEY (tenant_id, user_id)
```
One row per active user, upserted every 30 seconds by `tracker-heartbeat` edge function.
Rows older than 5 minutes are cleaned up by pg_cron (`cleanup-stale-presence`).
**RPC**: `upsert_user_presence(p_user_id, p_location_id, p_page_path)` — SECURITY DEFINER,
resolves `tenant_id` from `ghl_cache_locations`, replicates to other tenants via `replicate_presence()`.

#### `settings`
```
tenant_id     uuid PK FK → tenants
timezone      text
working_hours jsonb  ({start, end, days[]})
thresholds    jsonb  ({bounce_threshold_seconds, tracker_offline_minutes, ...})
enabled_events jsonb ({event_type: boolean})
created_at    timestamptz
updated_at    timestamptz
```

### RPC Functions

#### KPI Aggregation RPCs (migration 029)
These bypass PostgREST's pagination cap by computing aggregates entirely in Postgres.
All use `SECURITY DEFINER` with tenant resolved from `auth.uid()` → `tenant_members`.

- **`get_tracker_kpis(p_start, p_end, p_user_id?, p_location_id?)`**
  Returns: `total_sessions, total_seconds, unique_users, unique_locations, bounce_count`
  Source: `tracker_page_sessions` (raw data, for today/real-time)

- **`get_tracker_kpis_summary(p_start_date, p_end_date, p_user_id?, p_location_id?)`**
  Returns: same columns as above
  Source: `tracker_session_daily_summary` (for historical ranges)

- **`get_geo_session_aggregates(p_start, p_end)`**
  Returns: `geo_city, geo_region, geo_country, geo_lat, geo_lon, session_count, total_seconds, unique_users`
  Groups by city server-side. Replaces client-side 3,000-row paginated fetch.

- **`get_user_geo_latest(p_start, p_end)`**
  Returns: `user_id, geo_lat, geo_lon, geo_city, geo_region, geo_country`
  DISTINCT ON user_id, latest geo info per user.

- **`get_hourly_tracker_aggregates(p_start, p_end, p_user_id?, p_location_id?)`**
  Returns: `hour_bucket, total_minutes, session_count`
  Groups sessions by `date_trunc('hour', started_at)`. Bypasses 2000-row pagination cap.

- **`get_hourly_event_aggregates(p_start, p_end, p_user_id?, p_location_id?)`**
  Returns: `hour_bucket, event_count`
  Groups raw GHL events by `date_trunc('hour', event_date)`. Uses timestamptz, not DATE summary.

- **`get_feature_breakdown(p_start, p_end, p_user_id?, p_location_id?)`**
  Returns: `category, total_minutes, session_count`
  Groups sessions by `categorize_page_path()`. Server-side, bypasses 2000-row cap.
  Used by the Breakdown pie chart in Events/Usage toggle mode.

- **`get_daily_event_counts(p_start_date text, p_end_date text, p_user_id?, p_location_id?, p_excluded_types?)`**
  Returns: `event_date, event_count` — one row per date
  Source: `ghl_event_daily_summary`. Same table/date format/filtering as `get_event_summary_totals`.
  Guarantees chart event bars sum to KPI total.

- **`get_hourly_event_counts(p_start timestamptz, p_end timestamptz, p_user_id?, p_location_id?, p_excluded_types?)`**
  Returns: `hour_bucket, event_count` — one row per hour
  Source: raw `ghl_events`. Aggregated in Postgres — no 2000-row cap.
  Used for today's hourly Activity Chart view.

#### Other RPCs
- **`upsert_user_presence(p_user_id, p_location_id, p_page_path)`** — presence upsert
- **`replicate_presence(...)`** — copies presence to other tenants sharing location
- **`get_pipeline_status(p_tenant_id)`** — system health diagnostics
- **`get_unique_ghl_ids(p_tenant_id)`** — all unique location/user IDs for sync
- **`get_uncached_ghl_ids(p_tenant_id)`** — uncached IDs for incremental sync
- **`backfill_orphaned_sessions(p_tenant_id)`** — claim null-tenant rows
- **`upsert_tracker_summary_for_date(p_target_date)`** — daily summary rollup
- **`categorize_page_path(p_page_path)`** — SQL mirror of categorizePagePath()

---

## 4. Data Flow

### Tracker Session Flow
```
GHL user navigates a page
  ↓
docs/ghl-tracker-script.js fires (with client metadata: timezone, locale, screen, user_agent)
  ↓ POST /functions/v1/tracker-ingest (anon key, no tenant_id)
tracker-ingest Edge Function
  → extracts client IP from headers
  → calls ip-api.com for geo lookup (country, region, city, lat, lon, timezone)
  → inserts into tracker_page_sessions with geo + client metadata
  ↓ BEFORE INSERT: trg_auto_tenant_id
auto_fill_tenant_id()
  → looks up location_id in ghl_cache_locations → sets tenant_id
  → fallback: looks up ghl_oauth_tokens → sets tenant_id
  → if still null: leaves null (orphaned, invisible via RLS)
  ↓ Row inserted
  ↓ AFTER INSERT: trg_replicate_tracker_session
replicate_tracker_session_to_tenants()
  → finds ALL other tenants in ghl_cache_locations with same location_id
  → INSERTs a copy for each other tenant
  → pg_trigger_depth() > 1 guard prevents recursion
```

### GHL Webhook Flow
```
GoHighLevel fires webhook → POST /functions/v1/ghl-webhook
  ↓
ghl-webhook edge function
  → deduplicates via webhook_id
  → INSERTs into ghl_events (no tenant_id — trigger fills it)
  → upserts ghl_event_daily_summary for all tenants at that location
  → always returns HTTP 200 (prevents GHL retry storms)
  ↓ BEFORE INSERT: trg_auto_event_tenant_id → fills tenant_id
  ↓ AFTER INSERT: trg_replicate_ghl_event → copies to other tenants
```

### Presence (Online Status) Flow
```
GHL user is on a page (tracker script running)
  ↓ Every 30 seconds (plus immediately on page load)
POST /functions/v1/tracker-heartbeat { user_id, location_id, page_path }
  ↓
tracker-heartbeat Edge Function
  → calls RPC upsert_user_presence()
  → resolves tenant_id from ghl_cache_locations
  → INSERT ... ON CONFLICT DO UPDATE (last_seen_at = now())
  → replicate_presence() copies to other tenants sharing the location
  ↓
Frontend polls user_presence every 15 seconds (usePresence hook)
  → filters last_seen_at >= now - 2 minutes
  → returns onlineUserIds, onlineCount, userPages, onlineByLocation
  ↓
pg_cron every 5 minutes
  → DELETE FROM user_presence WHERE last_seen_at < now() - interval '5 minutes'
```

### Name Sync Flow
```
User triggers Force Refresh (or auto-sync from frontend hook)
  ↓ POST /functions/v1/sync-ghl-names
  → Phase 1: fetch ALL locations from GHL API /locations/search → upsert ghl_cache_locations
  → Phase 2: fetch ALL users from GHL API /users/search → upsert ghl_cache_users
  → Phase 3: RPC get_uncached_ghl_ids or get_unique_ghl_ids → individual API calls
  → Phase 4: RPC backfill_orphaned_sessions → claim null-tenant rows now that cache is populated
```

---

## 5. Edge Functions

### `bootstrap-tenant` (requires auth JWT)
Creates tenant + tenant_members + settings when a user clicks "Set Up Workspace".
Returns early if the user is already in a tenant.

### `create-user` (requires auth JWT, caller must be owner role)
Creates a new auth user AND adds them to the caller's tenant as `role: member`.
If the tenant_members insert fails, the auth user is deleted (rollback pattern).

### `tracker-ingest` (no JWT — `verify_jwt = false` in config.toml)
Receives tracker session data from the GHL tracker script. Enriches with IP-based geolocation
via ipapi.co (HTTPS, 1000/day) with ip-api.com as HTTP fallback (45 req/min).
Inserts into `tracker_page_sessions` with geo + client metadata.
The BEFORE INSERT trigger fills `tenant_id` as usual.

### `tracker-heartbeat` (no JWT — `verify_jwt = false` in config.toml)
Lightweight presence endpoint. Receives `{ user_id, location_id, page_path }` every 30 seconds
from the tracker script. Calls `upsert_user_presence()` RPC. Always returns 200.

### `ghl-webhook` (no JWT, public endpoint)
Receives all GHL webhook events. Always returns 200. Deduplicates via `webhook_id`.
Uses BEFORE/AFTER INSERT triggers for tenant assignment and replication.

### `sync-ghl-names` (no JWT — `verify_jwt = false` in config.toml)
Syncs GHL user and location names into the cache tables. Called by:
- Frontend "Force Refresh" button (Settings page)
- Auto-sync triggered by `useTrackerSessions` when unknown IDs are detected
Contains token refresh logic for expired GHL OAuth tokens.

### `integration-callback` (no JWT — `verify_jwt = false` in config.toml)
Handles GHL OAuth 2.0 flow. Two modes:
1. No `code` param → builds auth URL and redirects (302)
2. `code` param present → exchanges for tokens → upserts `ghl_oauth_tokens` → redirects to app

---

## 6. Multi-Tenant Architecture

### Why Location Sharing Exists
An agency might install SPARK for their company. One of their clients (a direct business) also
installs SPARK separately. Both connect to GHL. Both track the same `location_id`.
The replication triggers automatically copy tracker sessions and webhook events to all tenants
that have that `location_id` in their `ghl_cache_locations`.

### Trigger Guards
- `pg_trigger_depth() > 1` — prevents infinite recursion when the replicated INSERT fires its own trigger
- `IS DISTINCT FROM` — NULL-safe comparison (standard `!=` returns NULL when either side is NULL)

### The Chicken-and-Egg Problem
New tracker data arrives before the tenant's name cache is populated.
Solution: `backfill_orphaned_sessions` RPC claims null-tenant rows retroactively whenever a
sync run populates new cache entries.

---

## 7. Migration System

### Numbering Convention
Migrations are numbered sequentially: `001_name.sql`, `002_name.sql`, etc.
**NEVER create two files with the same number prefix.** Supabase CLI uses the full filename as
the version key — two `018_*.sql` files BOTH get tracked but in alphabetical order, which
creates ambiguity.

### Current Migration History
```
001 — production_refactor         Add tenant_id, RLS policies, triggers, RPCs
002 — fix_tenant_isolation        RLS policy fixes
003 — debug_tenant_isolation      Debug helpers
004 — add_company_id_and_fix      Company ID column, policy adjustments
005 — ghl_events                  ghl_events table + indexes + RLS
006 — fix_tenant_assignment       Trigger fixes
007 — event_daily_summary         ghl_event_daily_summary + pg_cron
008 — cleanup_cron                Cron cleanup
009 — user_preferences            Settings/preferences table
010 — purge_appinstall_events     Remove App Install event spam
011 — fix_tracker_session_trigger Trigger repair
012 — clear_empty_ghl_names       Remove empty string cache entries
013 — repair_data_visibility      Data visibility fixes
014 — tracker_session_summary     tracker_session_daily_summary table
015 — unified_backfill            Bulk backfill RPCs
016 — webhook_multi_routing       ⚠️ Multi-tenant PK changes, replication triggers
                                   (replication trigger used WRONG column names)
017 — restore_and_fix_triggers    Restored BEFORE INSERT triggers, IS DISTINCT FROM fix
                                   (replication trigger STILL had wrong column names)
018 — fix_webhook_conflict        Webhook unique index (tenant_id, webhook_id)
                                   (legacy duplicate 018_fix_tracker_replication was deleted)
019 — backfill_null_tenants       Claim orphaned events after first sync
020 — backfill_after_sync         Second backfill after cache was populated
021 — fix_broken_rpcs             Restore get_unique_ghl_ids, get_uncached_ghl_ids,
                                   backfill_orphaned_sessions (broken by SQL Editor edits)
022 — canonical_schema            ✅ Authoritative schema fix:
                                   - tracker_page_sessions correct columns
                                   - ghl_cache_users composite PK
                                   - replicate_tracker_session correct column names
                                   - get_uncached_ghl_ids composite join fix
023 — category_summary             tracker_session_daily_summary page_category column
024 — cleanup_old_tracker_sessions pg_cron job: DELETE tracker sessions > 7 days old (2 AM UTC)
025 — pipeline_status_rpc          get_pipeline_status() SECURITY DEFINER RPC for System Status
026 — geo_client_metadata          Add geo + client metadata columns to tracker_page_sessions
027 — user_presence                Real-time online status: user_presence table, upsert RPC,
                                   replicate_presence(), RLS, pg_cron cleanup every 5 min
028 — delete_user_presence         (cleanup migration)
029 — accurate_kpis                Server-side KPI RPCs (get_tracker_kpis, get_tracker_kpis_summary,
                                   get_geo_session_aggregates, get_user_geo_latest), cron fix, backfill
030 — scalable_queries             Server-side RPCs to eliminate PostgREST silent row caps:
                                   get_daily_activity_chart (sessions+events per day, no cap,
                                     p_excluded_types text[] for enabled_events filtering),
                                   get_event_summary_totals (events by type, no cap),
                                   get_cache_names (all location+user names, no cap)
                                   Note: also contains get_hourly_tracker_aggregates,
                                   get_feature_breakdown from earlier SQL editor sessions
031 — chart_event_rpcs             Single-source-of-truth event RPCs for Activity Over Time chart:
                                   get_daily_event_counts (per-date events from ghl_event_daily_summary,
                                     same table/date format/filtering as KPI — guarantees sum match),
                                   get_hourly_event_counts (per-hour events from raw ghl_events,
                                     aggregated in Postgres — no 2000-row cap)
```

### Schema Changes Made Outside Migrations (historical debt)
These changes were applied directly in the Supabase SQL Editor and are now documented here:
- `tracker_page_sessions`: removed `session_id`, `contact_id`, `is_bounce`, `page_views`; added `heartbeats`
- `ghl_cache_users` PK: changed from `(user_id)` to `(tenant_id, user_id)` (via migration 022)
- `get_unique_ghl_ids`, `get_uncached_ghl_ids`, `backfill_orphaned_sessions` RPCs: were edited
  directly in SQL Editor and restored via migrations 021/022

**Going forward**: ALL schema changes must be in numbered migration files. Never use the SQL Editor for DDL.

---

## 8. Frontend Architecture

### Provider Hierarchy
```
<QueryClientProvider>
  <AuthProvider>       ← provides user, tenant, tenantMode
    <FiltersProvider>  ← provides dateRange, locationFilter, userFilter
      <ThemeProvider>
        <App />
```

### Key Hooks

| Hook | Query Key | Source | Notes |
|------|-----------|--------|-------|
| `useTrackerSessions` | `['tracker-sessions', ...]` | `tracker_page_sessions` + `tracker_session_daily_summary` | Dual-path: raw today (paginated), summary history. Used for top-users/top-locations lists |
| `useDailyActivityChart` | `['daily-activity-chart', ...]` | RPCs `get_daily_activity_chart` + `get_daily_event_counts` | **Activity chart daily view** — session minutes from session RPC, event counts from event RPC (same source/format as KPI, guarantees sum match) |
| `useHourlyEventCounts` | `['hourly-event-counts', ...]` | RPC `get_hourly_event_counts` | Per-hour event counts for today view, aggregated in Postgres (no 2000-row cap) |
| `useGhlEvents` | `['ghl-event-summary', ...]` | RPC `get_event_summary_totals` | **No pagination cap** — returns one row per event_type with aggregated counts |
| `useGhlUserNames` | `['cache-names']` | RPC `get_cache_names` | Shared RPC returns all users+locations in one call, no cap |
| `useGhlLocationNames` | `['cache-names']` | RPC `get_cache_names` | Same shared RPC as useGhlUserNames — single network call |
| `useGhlConnection` | `['ghl-connection']` | `ghl_oauth_tokens` | 30s stale time |
| `usePresence` | `['user-presence', locationId?]` | `user_presence` | Polls every 15s, filters last_seen >= 2 min |
| `useOnlineUsers` | (wraps usePresence) | `user_presence` | Returns onlineUserIds Set, onlineCount, userPages Map, onlineByLocation Map |
| `useTrackerKpis` | `['tracker-kpis', ...]` | RPCs `get_tracker_kpis` + `get_tracker_kpis_summary` | Accurate KPIs via server-side aggregation, no pagination cap |
| `useGeoSessions` | `['geo-sessions', ...]` | RPCs `get_geo_session_aggregates` + `get_user_geo_latest` | Geo data aggregated by city server-side, no pagination cap |
| `useHourlySessionData` | `['hourly-sessions', ...]` | RPC `get_hourly_tracker_aggregates` | Accurate hourly session minutes, bypasses 2000-row cap |
| `useFeatureBreakdown` | `['feature-breakdown', ...]` | RPC `get_feature_breakdown` | Per-category minutes/sessions, server-side aggregation |
| `useAuth` | n/a | Supabase Auth + `tenant_members` | Clears QC on sign in/out |
| `useSettings` | `['settings']` | `settings` | Per-tenant config |

### Query Cache Invalidation
On `SIGNED_IN` and `SIGNED_OUT` events, the entire React Query cache is cleared
(`queryClient.clear()`). This prevents stale tenant data from leaking between users
on shared browsers.

### Auto-Sync Logic
`useTrackerSessions` monitors whether any session references a `user_id` or `location_id`
not present in the corresponding cache map. If so, it triggers `syncGhlNames()` in the
background. This is rate-limited by a `isSyncing` ref.

---

## 9. GHL Tracker Script

**Location**: `docs/ghl-tracker-script.js`
**Served at**: `/bundle-v3.js` by the Vite frontend (via `public/` or static serving)
**Installed via**: GHL Settings → Business Profile → Custom JS/CSS:
```html
<script src="https://YOUR_DOMAIN/bundle-v3.js"></script>
```

### What It Sends
```javascript
{
  user_id:          string,  // from GHL JWT cookie (m_a, m_s, or m_l)
  location_id:      string,  // from URL /location/<id>/
  page_path:        string,  // pathname + search string
  started_at:       string,  // ISO 8601
  ended_at:         string,  // ISO 8601 (updated on each heartbeat + session end)
  duration_seconds: number,  // computed at session end
  heartbeats:       number,  // count of 15-second active ticks
  details:          object   // {end_reason: 'beforeunload'|'route_change'|'visibility_hidden'}
}
```

### Presence Heartbeat
The script also sends a lightweight presence POST every 30 seconds to `/functions/v1/tracker-heartbeat`:
```javascript
{ user_id, location_id, page_path }
```
This is fire-and-forget (errors silently caught). An immediate heartbeat is sent on `startSession()`
so the user appears online right away. The `presenceTick` counter increments every 15s;
presence is sent every 2nd tick (30s interval).

### It Does NOT Send
- `tenant_id` (filled by BEFORE INSERT trigger)
- Any old columns: `session_id`, `contact_id`, `is_bounce`, `page_views`

### Credentials
The anon key is embedded in the script. This is acceptable — anon keys are designed to be
public and RLS prevents unauthorized data access. The service role key is NEVER in the frontend.

---

## 10. Common Gotchas

### NULL != anything in SQL
`WHERE tenant_id != NEW.tenant_id` returns NULL (no match) when `NEW.tenant_id IS NULL`.
**Always use** `IS DISTINCT FROM` for nullable comparisons in triggers.

### RLS Silent Denials
If a row has `tenant_id = NULL`, no authenticated user can see it (RLS policies filter on
`tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())`).
NULL is never IN any set. Orphaned rows are invisible, not errors.

### onConflict Must Match the PK
Supabase JS `.upsert({ ... }, { onConflict: "col" })` requires the column(s) to match an
existing UNIQUE constraint or PRIMARY KEY.
- `ghl_cache_locations`: `{ onConflict: "tenant_id,location_id" }`
- `ghl_cache_users`: `{ onConflict: "tenant_id,user_id" }`
- `ghl_event_daily_summary`: `{ onConflict: "tenant_id,location_id,event_date,event_type" }`

### Tracker Sessions Are Row-Level, Not Time-Series
Each row is one complete session. Duration is computed client-side at session end.
There is no streaming — only the final POST when the user leaves the page or switches route.

### pg_trigger_depth() Guard
The replication trigger inserts new rows, which would fire the trigger again (infinite loop).
`pg_trigger_depth() > 1` prevents this. Do NOT remove it.

### Summary Tables vs Raw Data
The frontend uses a dual-path strategy:
- **Today's raw data**: queried directly from `tracker_page_sessions` (up to 2000 rows)
- **Historical data**: queried from `tracker_session_daily_summary` (aggregated, much faster)
Summary rows use fake timestamps of `12:00:00` — they should not be mixed with hourly charts.

### Supabase PostgREST max_rows = 1000 (default)
Supabase PostgREST silently caps any query at 1000 rows regardless of `.limit()`.
**All critical data paths now use server-side RPCs that bypass this cap entirely:**
- **KPIs**: `get_tracker_kpis` + `get_tracker_kpis_summary` (via `useTrackerKpis`)
- **Activity Chart (daily sessions)**: `get_daily_activity_chart` (via `useDailyActivityChart`)
- **Activity Chart (daily events)**: `get_daily_event_counts` (via `useDailyActivityChart`)
- **Activity Chart (hourly sessions)**: `get_hourly_tracker_aggregates` (via `useHourlySessionData`)
- **Activity Chart (hourly events)**: `get_hourly_event_counts` (via `useHourlyEventCounts`)
- **Event totals**: `get_event_summary_totals` (via `useGhlEvents`)
- **Geo data**: `get_geo_session_aggregates` + `get_user_geo_latest` (via `useGeoSessions`)
- **Feature breakdown**: `get_feature_breakdown` (via `useFeatureBreakdown`)
- **Name cache**: `get_cache_names` (via `useGhlLocationNames` / `useGhlUserNames`)

The only remaining paginated query is `useTrackerSessions` which fetches raw today's sessions
with `.range(0, 999)` + `.range(1000, 1999)` (2000 row cap). This is used for Top Users/
Top Locations ranked lists — acceptable since only the top N are displayed.

### KPI Headline Numbers vs Row-Level Rankings
KPI cards (Sessions, Active Time, Users, Locations, Avg Duration, Bounce Rate) come from
server-side RPCs (`useTrackerKpis`) which aggregate ALL data in Postgres — no pagination cap.
Row-level rankings (Top Users, Top Locations) come from `useTrackerSessions` which is still
capped at 2,000 raw rows. This is acceptable for ranked lists but means the totals in those
lists won't match the headline KPIs exactly at very high volume.

### Enabled Events Filtering Must Be Consistent
Users can disable event types in Settings → `enabled_events` (JSONB: `{event_type: false}`).
All event display paths must apply the **same** filtering logic:
1. **`useEnabledGhlEvents`** — client-side filter on `useGhlEvents` output (KPI number, cards, pie chart)
2. **`useDailyActivityChart`** — passes `p_excluded_types` to `get_daily_event_counts` RPC (Activity Chart daily view)
3. **`useHourlyEventCounts`** — passes `p_excluded_types` to `get_hourly_event_counts` RPC (Activity Chart hourly view)
The logic: exclude types where `enabled_events[type] === false`, PLUS always exclude INSTALL (server-side via `NOT ILIKE '%install%'`).

### Chart Event Totals Must Match KPI
The GHL Events KPI number and the Activity Over Time chart event bars MUST use the same
data source. Both use `ghl_event_daily_summary` with timezone-formatted date strings (`yyyy-MM-dd`).
The KPI goes through `get_event_summary_totals` → `useEnabledGhlEvents`, while the chart goes
through `get_daily_event_counts` → `useDailyActivityChart`. Both RPCs use identical WHERE clauses
on the same table with the same date format, guaranteeing `sum(chart_bars) === KPI_total`.
For today's hourly view, `get_hourly_event_counts` aggregates raw `ghl_events` in Postgres
with the same filtering — no 2000-row cap.

### is_bounce Does NOT Exist
Never reference `is_bounce` in any SQL. Use `COALESCE(duration_seconds, 0) < 10` instead.

### Edge Function JWT Verification
Four functions have `verify_jwt = false` in `supabase/config.toml`:
- `sync-ghl-names` (called by frontend without service role)
- `integration-callback` (OAuth callback, no user context)
- `tracker-ingest` (called by tracker script from GHL domain, no auth context)
- `tracker-heartbeat` (called by tracker script for presence, no auth context)
All other functions require a valid JWT in the Authorization header.

---

## 11. Deployment Checklist

### Deploy edge functions
```bash
# Deploy all functions
supabase functions deploy sync-ghl-names --project-ref xrcurxegylqjrbmfihte
supabase functions deploy ghl-webhook --project-ref xrcurxegylqjrbmfihte
supabase functions deploy create-user --project-ref xrcurxegylqjrbmfihte
supabase functions deploy bootstrap-tenant --project-ref xrcurxegylqjrbmfihte
supabase functions deploy integration-callback --project-ref xrcurxegylqjrbmfihte
supabase functions deploy tracker-ingest --project-ref xrcurxegylqjrbmfihte
supabase functions deploy tracker-heartbeat --project-ref xrcurxegylqjrbmfihte
```

### Apply migrations
```bash
supabase db push --project-ref xrcurxegylqjrbmfihte
```

### Required Supabase secrets (set via Dashboard or CLI)
```
GHL_CLIENT_ID
GHL_CLIENT_SECRET
```

### After deploying a fix that touches the replication trigger
1. Apply the migration (`supabase db push`)
2. Trigger a Force Refresh sync from Settings page
3. Verify new rows appear in `tracker_page_sessions`

---

## 12. Supabase Project Reference

- **Project ref**: `xrcurxegylqjrbmfihte`
- **Project name**: Dashboard Tracker
- **Region**: (check Supabase dashboard)
- **Anon key**: in `src/lib/constants.ts` (public, safe to commit)
- **Service role key**: in Supabase secrets only, NEVER commit to git

---

## 13. Timezone Protocol

**These rules are mandatory for ALL date/time code in this codebase.**

### Rule 1: Never use bare date-fns on UTC instants
`startOfDay`, `endOfDay`, `eachDayOfInterval`, `eachHourOfInterval` from `date-fns`
use the **browser's local timezone** — NOT the user's configured timezone.
Always wrap with `toZonedTime`/`fromZonedTime` from `date-fns-tz`:
```typescript
const startInTz = toZonedTime(dateRange.from, timezone);
const endInTz = toZonedTime(dateRange.to, timezone);
const intervals = eachDayOfInterval({ start: startInTz, end: endInTz })
  .map(d => fromZonedTime(d, timezone));
```

### Rule 2: dateRange.from / dateRange.to are UTC instants
They represent calendar day boundaries in the user's configured timezone.
Use them directly in DB queries (`.gte('started_at', dateRange.from.toISOString())`).

### Rule 3: For chart labels, always use formatInTimeZone
```typescript
formatInTimeZone(date, timezone, 'h a')     // "2 PM"
formatInTimeZone(date, timezone, 'MMM dd')   // "Feb 25"
```
NEVER use `format(date, ...)` or `parseISO(string) + format(...)` chain.

### Rule 4: DATE-only columns need the noon UTC trick
`ghl_event_daily_summary.event_date` and `tracker_session_daily_summary.date` are DATE type
(no time/timezone). When parsing: `parseISO(\`${dateStr}T12:00:00Z\`)`.
Noon UTC ensures the correct date in any timezone from UTC-12 to UTC+12.

### Rule 5: Server-side aggregation for chart data
- **Hourly sessions**: `get_hourly_tracker_aggregates` RPC via `useHourlySessionData` hook.
- **Hourly events**: `get_hourly_event_counts` RPC via `useHourlyEventCounts` hook (aggregated in Postgres, no row cap).
- **Features**: `get_feature_breakdown` RPC via `useFeatureBreakdown` hook.
- **Daily**: Summary tables + timezone-safe date filtering (Rule 1 intervals).
- **KPIs**: `get_tracker_kpis` + `get_tracker_kpis_summary` via `useTrackerKpis` hook.

Row-level session data (`useTrackerSessions`) is for rankings, detail tables only —
NEVER for headline KPIs, chart aggregation, or feature breakdowns (2000-row cap makes it lossy).

### Rule 7: Page category mapping
Both JS (`categorizePagePath` in `src/lib/helpers.ts`) and SQL (`categorize_page_path()`)
must stay in sync. Current categories:
- Dashboard, Conversations, Contacts (+ /customers), Opportunities (+ /funnels)
- Calendars, Automations (+ /workflow singular), Reporting, Settings (+ /crm-settings)
- Marketing, Media, Tasks, Apps (/custom-menu-link), Payments, Sites
- Reputation, Social, Memberships, Forms, Phone, Email, Other

Historical summary rows with `page_category = 'Other'` from before migration 023 are
permanent — raw sessions were deleted before the expanded categorization was applied.

### Rule 6: Summary tables use UTC dates
DATE columns in summary tables represent UTC calendar dates. When filtering:
```typescript
const fromDate = formatInTimeZone(dateRange.from, timezone, 'yyyy-MM-dd');
const toDate = formatInTimeZone(dateRange.to, timezone, 'yyyy-MM-dd');
```
