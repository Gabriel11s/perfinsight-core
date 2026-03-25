# Dashboard Tracker

> **GoHighLevel usage analytics and adoption tracking platform by Dashboard Tracker.**
> Monitors how GHL sub-account users navigate the platform, which pages they visit, session durations, and adoption across locations — providing agency owners with actionable insights.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Architecture Overview](#architecture-overview)
3. [Project Structure](#project-structure)
4. [Getting Started](#getting-started)
5. [Environment Variables](#environment-variables)
6. [Database Schema](#database-schema)
7. [Row Level Security (RLS)](#row-level-security-rls)
8. [Authentication & Multi-Tenancy](#authentication--multi-tenancy)
9. [GHL Tracker Script (Data Collection)](#ghl-tracker-script-data-collection)
10. [GHL OAuth Integration](#ghl-oauth-integration)
11. [Edge Functions](#edge-functions)
12. [Frontend Architecture](#frontend-architecture)
13. [Hooks Reference](#hooks-reference)
14. [Helpers & Utilities](#helpers--utilities)
15. [Pages Reference](#pages-reference)
16. [Component Library](#component-library)
17. [Deployment](#deployment)
18. [Common Gotchas](#common-gotchas)

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18 + TypeScript + Vite |
| **Styling** | Tailwind CSS v3 + shadcn/ui (Radix primitives) |
| **State/Data** | TanStack React Query v5 |
| **Routing** | React Router v6 |
| **Charts** | Recharts |
| **Backend** | Supabase (PostgreSQL, Auth, Edge Functions, RLS) |
| **Integration** | GoHighLevel REST API (OAuth 2.0) |
| **Edge Runtime** | Deno (Supabase Edge Functions) |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    GoHighLevel Platform                      │
│   ┌──────────────────────────────────────────────────────┐  │
│   │  Custom JS Tracker (ghl-tracker-script.js)           │  │
│   │  - Reads JWT cookies for user_id                     │  │
│   │  - Reads URL path for location_id                    │  │
│   │  - Sends heartbeats every 15s                        │  │
│   │  - POSTs session data on route change/tab close      │  │
│   └──────────────────────┬───────────────────────────────┘  │
└──────────────────────────┼──────────────────────────────────┘
                           │ REST POST (anon key)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Supabase Backend                          │
│                                                             │
│  ┌─────────────────────┐   ┌──────────────────────────────┐│
│  │ tracker_page_sessions│   │ Edge Functions               ││
│  │ (main data table)   │   │ - bootstrap-tenant           ││
│  │                     │   │ - integration-callback        ││
│  │ Trigger:            │   │ - sync-ghl-names             ││
│  │ auto_fill_tenant_id │   │ - create-user                ││
│  └────────┬────────────┘   └──────────────────────────────┘│
│           │ RLS (tenant-scoped)                             │
│  ┌────────┴────────────────────────────────────────────────┐│
│  │ Supporting Tables:                                      ││
│  │ tenants, tenant_members, settings,                      ││
│  │ ghl_oauth_tokens, ghl_cache_users, ghl_cache_locations, ││
│  │ alerts                                                  ││
│  └─────────────────────────────────────────────────────────┘│
└──────────────────────────┬──────────────────────────────────┘
                           │ Supabase JS Client (authenticated)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    React Dashboard (Vite)                    │
│  - Overview (KPIs, charts, leaderboards)                    │
│  - Users (table, search, status pills)                      │
│  - Locations (health monitoring, search)                    │
│  - User/Location Detail (activity charts, timelines)        │
│  - Settings (GHL connect/disconnect, sync, thresholds)      │
│  - Alerts & Reports (coming soon)                           │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow Summary

1. **Collection:** The GHL tracker script (injected as Custom JS in GHL) captures page sessions and POSTs them to Supabase using the `anon` key.
2. **Tenant Association:** A PostgreSQL `BEFORE INSERT` trigger (`auto_fill_tenant_id`) maps each session to a tenant by looking up `location_id` in `ghl_cache_locations` → `ghl_oauth_tokens`. If no mapping exists, `tenant_id` stays NULL.
3. **Multi-Tenant Replication:** An `AFTER INSERT` cloning trigger detects if multiple agencies track the exact same `location_id` and instantly replicates the payload into all subscribed tenants.
4. **Name Resolution:** The `sync-ghl-names` edge function fetches human-readable names from the GHL API and caches them in `ghl_cache_users` / `ghl_cache_locations` using a composite primary key (`tenant_id`, `location_id`).
5. **Backfill:** When a tenant first syncs GHL names, the `sync-ghl-names` edge function calls the `backfill_orphaned_sessions` RPC to retroactively claim any NULL-tenant sessions and webhook events matching their locations, instantly regenerating the daily rollups.
6. **Dashboard:** The React frontend queries `tracker_page_sessions` and `ghl_event_daily_summary` (filtered by date range via `useFilters`) and joins with the name cache to display analytics.

---

## Project Structure

```
SPARK TRACKER 2/
├── docs/
│   ├── ghl-tracker-script.js          # The GHL Custom JS tracker (copy into GHL)
│   └── PLAN_event_summarization.md    # Plan to refactor ghl_events into daily summaries
│
├── src/
│   ├── App.tsx                     # Root component — providers, routing
│   ├── main.tsx                    # Vite entry point
│   ├── index.css                   # Design system (CSS variables, animations, utilities)
│   │
│   ├── components/
│   │   ├── ErrorBoundary.tsx       # Global error boundary
│   │   ├── NavLink.tsx             # React Router NavLink wrapper with active styles
│   │   ├── TenantSetup.tsx         # First-run tenant bootstrap UI
│   │   ├── dashboard/
│   │   │   ├── EventSummaryCards.tsx # Categorized GHL event cards with expandable detail
│   │   │   ├── GhlWarningBanner.tsx  # "GHL not connected" inline alert
│   │   │   └── KpiCard.tsx           # Reusable metric card with accent colors
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx       # Sidebar + Topbar + main content area
│   │   │   ├── AppSidebar.tsx      # Sectioned nav (Analytics/Operations), user footer
│   │   │   └── Topbar.tsx          # Period selector, theme toggle, menu button
│   │   └── ui/                     # shadcn/ui primitives (button, input, card, etc.)
│   │
│   ├── hooks/
│   │   ├── use-auth.tsx            # AuthProvider context (user, tenant, signOut)
│   │   ├── use-filters.tsx         # FiltersProvider (dateRange, preset, location/user filters)
│   │   ├── use-ghl-connection.ts   # GHL OAuth token status query + connect URL builder
│   │   ├── use-ghl-events.ts       # GHL event hooks (useGhlEvents, useEnabledGhlEvents)
│   │   ├── use-mobile.tsx          # Mobile viewport detection
│   │   ├── use-settings.ts         # Settings CRUD (useSettings, useUpdateSettings)
│   │   ├── use-theme.tsx           # Dark/light theme toggle with localStorage
│   │   ├── use-toast.ts            # Toast notification hook
│   │   └── use-tracker-data.ts     # Core data hooks (sessions, GHL name caches)
│   │
│   ├── integrations/
│   │   └── supabase/
│   │       └── client.ts           # Supabase client singleton
│   │
│   ├── lib/
│   │   ├── constants.ts            # SUPABASE_URL, ANON_KEY, GHL_CLIENT_ID, scopes
│   │   ├── helpers.ts              # normalizePagePath, categorizePagePath, formatDuration, etc.
│   │   ├── sync-ghl.ts             # Client-side wrapper to invoke sync-ghl-names edge function
│   │   └── utils.ts                # cn() utility (clsx + tailwind-merge)
│   │
│   ├── pages/
│   │   ├── Auth.tsx                # Login/signup page
│   │   ├── Overview.tsx            # Main dashboard (KPIs, charts, leaderboards, GHL Activity)
│   │   ├── Users.tsx               # User list with search, sort, status pills
│   │   ├── UserDetail.tsx          # Individual user analytics + GHL events
│   │   ├── Locations.tsx           # Location list with health monitoring
│   │   ├── LocationDetail.tsx      # Individual location analytics + GHL events
│   │   ├── Settings.tsx            # GHL integration, sync, threshold config, event toggles
│   │   ├── Alerts.tsx              # Alerts page (coming soon)
│   │   ├── Reports.tsx             # Reports page (coming soon)
│   │   ├── Index.tsx               # Redirect to /
│   │   └── NotFound.tsx            # 404 page
│   │
│   └── types/
│       └── index.ts                # All TypeScript interfaces
│
├── supabase/
│   ├── functions/
│   │   ├── bootstrap-tenant/       # Creates tenant + membership + settings
│   │   ├── create-user/            # Admin user creation
│   │   ├── ghl-webhook/            # GHL webhook receiver (inserts into ghl_events)
│   │   ├── integration-callback/   # GHL OAuth callback handler
│   │   └── sync-ghl-names/         # Fetches & caches GHL user/location names
│   └── migrations/
│       ├── 001_production_refactor.sql        # Full schema migration
│       ├── 002_fix_tenant_isolation.sql       # Fix tenant_id trigger + backfill RPC
│       ├── 004_add_company_id_and_fix_policies.sql  # Add company_id, fix RLS policies
│       ├── 005_ghl_events.sql                 # GHL events table + RLS + auto-fill trigger
│       └── 006_fix_tenant_assignment.sql      # One-time fix for tenant_id mismatch
│
├── package.json
├── tailwind.config.ts
├── vite.config.ts
├── tsconfig.json
└── README.md
```

---

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Start dev server (runs on http://localhost:8080)
npm run dev

# 3. Build for production
npm run build

# 4. Run tests
npm test
```

### Prerequisites

- Node.js 18+
- Supabase CLI (`npm i -g supabase`)
- A Supabase project (PostgreSQL + Auth + Edge Functions)
- A GoHighLevel Marketplace app (for OAuth integration)

---

## Environment Variables

The app uses `VITE_` prefixed env vars with hardcoded fallbacks in `src/lib/constants.ts`:

| Variable | Description | Default |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL | `https://xrcurxegylqjrbmfihte.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key | *(hardcoded)* |
| `VITE_GHL_CLIENT_ID` | GHL Marketplace app client ID | `69b8b5d41be630d182694cf0-mmu0m4ia` |

### Supabase Edge Function Secrets

These must be set via `supabase secrets set`:

| Secret | Description |
|---|---|
| `GHL_CLIENT_ID` | GoHighLevel OAuth client ID |
| `GHL_CLIENT_SECRET` | GoHighLevel OAuth client secret |
| `SUPABASE_URL` | Auto-provided by Supabase |
| `SUPABASE_ANON_KEY` | Auto-provided by Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-provided by Supabase |

---

## Database Schema

### Core Tables

#### `tenants`

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` (PK) | Tenant identifier |
| `name` | `text` | Agency/org name |
| `mode` | `text` | `'agency'` or `'single_location'` |
| `owner_user_id` | `uuid` | Auth user who created the tenant |
| `created_at` | `timestamptz` | Creation timestamp |

#### `tenant_members`

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` (PK) | Membership ID |
| `tenant_id` | `uuid` (FK → tenants) | Which tenant |
| `user_id` | `uuid` (FK → auth.users) | Which auth user |
| `role` | `text` | `'owner'`, `'admin'`, or `'viewer'` |
| `created_at` | `timestamptz` | Join timestamp |

#### `tracker_page_sessions`

The **primary data table** — every row is one page-visit session from GHL.

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` (PK) | Session ID |
| `tenant_id` | `uuid` (FK → tenants) | Auto-filled by trigger |
| `location_id` | `text` | GHL sub-account ID |
| `user_id` | `text` | GHL user ID (from JWT cookie) |
| `page_path` | `text` | URL path visited |
| `started_at` | `timestamptz` | Session start time |
| `ended_at` | `timestamptz` | Session end time |
| `duration_seconds` | `integer` | Total duration |
| `heartbeats` | `integer` | Number of 15s heartbeats |
| `details` | `jsonb` | Extra metadata (e.g. `end_reason`) |
| `created_at` | `timestamptz` | Row creation time |

**Triggers:**
1. `BEFORE INSERT` (`auto_fill_tenant_id`): Maps `location_id` to a `tenant_id` via `ghl_cache_locations` or `ghl_oauth_tokens`. If not found, stays NULL (orphaned).
2. `AFTER INSERT` (`replicate_tracker_session_to_tenants`): If multiple tenants cache this `location_id`, it explicitly clones the row to all other subscribed tenants so everyone receives the analytics payload independently.

Orphaned sessions (and webhook events) are retroactively backfilled when `sync-ghl-names` runs via the comprehensive `backfill_orphaned_sessions` RPC algorithm.

#### `ghl_oauth_tokens`

| Column | Type | Description |
|---|---|---|
| `tenant_id` | `uuid` (PK, FK → tenants) | One token per tenant |
| `access_token` | `text` | GHL API access token |
| `refresh_token` | `text` | GHL refresh token |
| `expires_at` | `timestamptz` | Token expiry |
| `location_id` | `text` | GHL location tied to this OAuth |
| `company_id` | `text` | GHL company/agency ID (for location discovery) |
| `updated_at` | `timestamptz` | Last refresh time |

#### `ghl_cache_locations`

| Column | Type | Description |
|---|---|---|
| `tenant_id` | `uuid` (PK, FK → tenants) | Owner tenant |
| `location_id` | `text` (PK) | GHL location ID (Composite PK allows multi-tenant overlap) |
| `location_name` | `text` | Human-readable name |
| `updated_at` | `timestamptz` | Last sync time |

#### `ghl_cache_users`

| Column | Type | Description |
|---|---|---|
| `tenant_id` | `uuid` (FK → tenants) | Owner tenant |
| `user_id` | `text` (PK) | GHL user ID |
| `user_name` | `text` | Human-readable name |
| `location_id` | `text` | Associated location (nullable) |
| `updated_at` | `timestamptz` | Last sync time |

#### `ghl_event_daily_summary`

Summarized GHL webhook events. Aggregated daily per location and event type.

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` (PK) | Summary ID |
| `tenant_id` | `uuid` (FK → tenants) | Auto-filled by trigger |
| `location_id` | `text` | GHL sub-account ID |
| `event_date` | `date` | Date of the summary |
| `event_type` | `text` | e.g. `'AppointmentCreate'`, `'InboundMessage'` |
| `event_count` | `integer` | Total number of events |
| `sms_count` | `integer` | Number of SMS messages |
| `call_count` | `integer` | Number of Calls |
| `email_count` | `integer` | Number of Emails |
| `other_msg_count` | `integer` | Number of other messages |
| `user_counts` | `jsonb` | Map of user IDs to event counts for that type |
| `created_at` | `timestamptz` | Row creation time |
| `updated_at` | `timestamptz` | Last updated time |

**Note:** Raw events are still written to `ghl_events` as a 7-day rolling buffer for the Activity Feed, managed by a pg_cron cleanup job.

#### `settings`

| Column | Type | Description |
|---|---|---|
| `tenant_id` | `uuid` (PK, FK → tenants) | One settings row per tenant |
| `timezone` | `text` | e.g. `'America/Sao_Paulo'` |
| `working_hours` | `jsonb` | `{ start, end, days }` |
| `thresholds` | `jsonb` | Alert thresholds (see below) |
| `enabled_events` | `jsonb` | Toggle visibility per GHL event type (see below) |
| `ghl_token_webhook_url` | `text` | Optional webhook URL |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

**Thresholds object:**
```json
{
  "no_activity_days": 7,
  "min_minutes_week": 30,
  "usage_drop_pct": 50,
  "bounce_threshold_seconds": 10,
  "tracker_offline_minutes": 60
}
```

**enabled_events object:**
```json
{
  "AppointmentCreate": true,
  "AppointmentUpdate": true,
  "ContactCreate": true,
  "InboundMessage": true,
  "OutboundMessage": true,
  ...
}
```
Keys are GHL event type strings. `false` hides the event from dashboard cards.

#### `alerts`

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` (PK) | Alert ID |
| `tenant_id` | `uuid` (FK → tenants) | |
| `severity` | `text` | `'low'`, `'medium'`, `'high'` |
| `type` | `text` | Alert type |
| `location_id` | `text` | (nullable) |
| `user_id` | `text` | (nullable) |
| `metric` | `jsonb` | Alert-specific data |
| `status` | `text` | `'open'` or `'closed'` |
| `created_at` | `timestamptz` | |

### RPC Functions

#### `get_unique_ghl_ids(p_tenant_id uuid)`
Returns **all** unique `location_id` and `user_id` values from `tracker_page_sessions` for a tenant. Used for full refresh sync.

#### `get_uncached_ghl_ids(p_tenant_id uuid)`
Returns only IDs **not yet** in the cache tables. Used for incremental sync.

---

## Row Level Security (RLS)

All tables have RLS enabled. Policies use the `tenant_members` table to scope access:

```sql
-- Pattern used across all tables:
tenant_id IN (
  SELECT tenant_id FROM public.tenant_members
  WHERE user_id = auth.uid()
)
```

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `tracker_page_sessions` | ✅ tenant-scoped | ✅ anon (open, for tracker script) | — | — |
| `ghl_events` | ✅ tenant-scoped | ✅ service_role (via edge function) | — | — |
| `tenants` | ✅ tenant-scoped | — | — | — |
| `tenant_members` | ✅ own rows | — | — | — |
| `ghl_cache_users` | ✅ tenant-scoped | — | — | — |
| `ghl_cache_locations` | ✅ tenant-scoped | — | — | — |
| `ghl_oauth_tokens` | ✅ tenant-scoped | — | — | ✅ tenant-scoped |
| `settings` | ✅ tenant-scoped | ✅ tenant-scoped | ✅ tenant-scoped | — |
| `alerts` | ✅ tenant-scoped | — | — | — |

> **Critical:** The `anon_insert_sessions` policy on `tracker_page_sessions` allows **any** POST with the anon key (no auth). This is intentional — the GHL tracker script runs in GHL's browser context where the user is not authenticated to Supabase.

---

## Authentication & Multi-Tenancy

### Auth Flow

1. User signs in via Supabase Auth (email/password) on `/auth`.
2. `AuthProvider` (`use-auth.tsx`) listens for auth state changes.
3. On login, it fetches the user's `tenant_members` row to resolve their `tenant_id`.
4. It then fetches the full `tenants` row and provides it via context.
5. If no tenant membership exists, `AppLayout` renders `TenantSetup` instead of the dashboard.
6. `TenantSetup` invokes the `bootstrap-tenant` edge function to create tenant + membership + settings.

### Multi-Tenancy Model

```
auth.users (Supabase Auth)
    │
    ▼
tenant_members (user_id → tenant_id + role)
    │
    ▼
tenants (id, name, mode)
    │
    ├── tracker_page_sessions (tenant_id)
    ├── ghl_oauth_tokens (tenant_id)
    ├── ghl_cache_users (tenant_id)
    ├── ghl_cache_locations (tenant_id)
    ├── settings (tenant_id)
    └── alerts (tenant_id)
```

Every data table is scoped to `tenant_id`. RLS enforces this at the database level.

### Roles

| Role | Capabilities |
|---|---|
| `owner` | Full access, can create users, manage settings |
| `admin` | View all data, manage settings |
| `viewer` | View-only access to analytics |

---

## GHL Tracker Script (Data Collection)

**File:** `/public/bundle-v3.js`

This is the **Custom JavaScript** that agency owners embed into GoHighLevel's settings. It runs on every page load inside GHL and tracks user behavior securely using Supabase.

### How It Works

1. **Extracts `user_id`** by decoding GHL's JWT cookies (`m_a`, `m_s`, `m_l`). Searches through multiple possible payload fields: `primaryUser.id`, `user.id`, `locationUser.id`, `impersonatedUser.id`, `primaryUserId`, `userId`, `authClassId`.

2. **Extracts `location_id`** from the URL path (`/location/<id>/...`).

3. **Only tracks** if both `user_id` AND `location_id` are found.

4. **Session lifecycle:**
   - `startSession()` — called on page load and route changes
   - Heartbeat interval (every 15 seconds) increments the heartbeat counter when tab is visible
   - `stopSession()` — called on route change, `beforeunload`, or `visibilitychange` to hidden
   - Session data is POSTed to Supabase via REST API with `keepalive: true`

5. **Route change detection** — Monkey-patches `history.pushState` and `history.replaceState` to detect GHL's SPA navigation.

### Session Data Sent

```json
{
  "user_id": "abc123...",
  "location_id": "def456...",
  "page_path": "/location/def456/contacts",
  "started_at": "2026-02-19T12:00:00.000Z",
  "ended_at": "2026-02-19T12:05:30.000Z",
  "duration_seconds": 330,
  "heartbeats": 22,
  "details": { "end_reason": "route_change" }
}
```

### Installation

To install the tracking algorithm, you do **not** need to paste the raw source code anymore. Instead, the Vite server globally hosts the file as a static CDN asset for superior reliability and instant software updates.

1. In GoHighLevel, go to **Settings → Business Profile → Custom JS/CSS**
2. Paste the following HTML tag:
   ```html
   <script src="https://YOUR_DOMAIN/bundle-v3.js"></script>
   ```
3. Save

> ⚠️ If you change `VITE_SUPABASE_URL` or the anon key, you must remember to manually update `public/bundle-v3.js` natively before deploying.

---

## GHL OAuth Integration

The OAuth flow connects Dashboard Tracker to a GHL sub-account to fetch user and location names.

### OAuth Flow

```
User clicks "Connect GoHighLevel" button
    │
    ▼
Frontend builds OAuth URL via getGhlConnectUrl()
  (encodes tenant_id + redirect_url in state param)
    │
    ▼
GHL Marketplace OAuth consent screen
    │
    ▼
GHL redirects to: integration-callback?code=xxx&state=yyy
    │
    ▼
Edge function exchanges code for tokens
    │
    ▼
Tokens upserted to ghl_oauth_tokens
    │
    ▼
Redirect back to /settings?ghl=connected
```

### OAuth Scopes

| Scope | Purpose |
|---|---|
| `locations.readonly` | Read sub-account info (names) |
| `calendars/events.readonly` | Calendar events |
| `calendars.readonly` | Calendar configurations |
| `conversations.readonly` | Conversations |
| `conversations/message.readonly` | Messages |
| `contacts.readonly` | Contacts |
| `locations/tasks.readonly` | Tasks |
| `locations/tags.readonly` | Tags |
| `opportunities.readonly` | Pipeline opportunities |

### Disconnecting

The Settings page has a **Disconnect** button that:
1. Deletes the `ghl_oauth_tokens` row for the tenant (requires `tokens_delete_own` RLS policy)
2. Invalidates the `ghl-connection` query cache
3. UI immediately shows "Not connected" state

---

## Edge Functions

All edge functions run on Deno (Supabase Edge Runtime) and use `@supabase/supabase-js` via `esm.sh`.

### `bootstrap-tenant`

**Purpose:** First-run setup — creates a tenant, membership, and default settings.

| Step | Action |
|---|---|
| 1 | Verify calling user is authenticated |
| 2 | Check if user already has a tenant membership |
| 3 | If not, create a `tenants` row (mode: `agency`) |
| 4 | Create a `tenant_members` row (role: `owner`) |
| 5 | Create a `settings` row with defaults |

**Invoked by:** `TenantSetup.tsx` component on first login.

**Request:** `POST` with body `{ name: "Spark Agency" }`

**Response:** `{ tenant_id: "uuid", message: "Tenant created" }`

---

### `integration-callback`

**Purpose:** Handles the GHL OAuth callback. Two modes:

1. **Initiate (no `code` param):** Builds the GHL OAuth URL with scopes and redirects.
2. **Callback (has `code` param):**
   - Decodes `state` param to extract `tenant_id` and `redirect_url`
   - Validates `tenant_id` is a real UUID and exists in the DB
   - Exchanges auth code for access + refresh tokens
   - Upserts tokens into `ghl_oauth_tokens`
   - Redirects back to the app with `?ghl=connected`

**Security:** Validates tenant_id format (UUID regex) and existence before processing.

---

### `sync-ghl-names`

**Purpose:** Fetches human-readable names from the GHL API and caches them locally.

| Step | Action |
|---|---|
| 1 | Authenticate the calling user |
| 2 | Resolve their tenant via `tenant_members` |
| 3 | Get or refresh the GHL access token |
| 4 | Call RPC to get IDs needing sync (`get_uncached_ghl_ids` or `get_unique_ghl_ids`) |
| 5 | Batch-fetch location names from GHL API (`GET /locations/{id}`) |
| 6 | Batch-fetch user names from GHL API (`GET /users/{id}`) |
| 7 | Upsert results into `ghl_cache_locations` and `ghl_cache_users` |

**Modes:**
- **Incremental** (default): Only fetches IDs not yet in the cache.
- **Full Refresh** (`forceRefresh: true`): Re-fetches all known IDs.

**Rate Limiting:** Batches of 3 concurrent requests with 500ms delay between batches. Auto-retries on 429 responses (up to 3 retries with backoff).

**Token Auto-Refresh:** If the access token is within 5 minutes of expiry, automatically refreshes it before making API calls.

**Request:** `POST` with body `{ forceRefresh: false }`

**Response:**
```json
{
  "locationsUpserted": 5,
  "usersUpserted": 12,
  "locationErrors": [],
  "userErrors": [],
  "mode": "incremental"
}
```

**Step 4a — Proactive Location Discovery:** If a `company_id` is stored in the token, calls `GET /locations/search?companyId={id}` to fetch ALL sub-accounts under the GHL agency. Each location is upserted into `ghl_cache_locations`, establishing the `location_id → tenant_id` mapping. This solves the chicken-and-egg problem where orphaned sessions couldn't be claimed.

**Step 4b — RPC Fallback:** Calls RPC functions to find any remaining location/user IDs from existing `tracker_page_sessions` that aren't yet cached.

**Steps 5-6 — Batch Fetch:** For any IDs from Step 4b, fetches individual locations and users from the GHL API.

**Step 7 — Backfill:** After syncing names, calls `backfill_orphaned_sessions(p_tenant_id)` RPC to claim any `tracker_page_sessions` with `tenant_id IS NULL` that match the tenant's cached locations.

**Invoked by:** The "Sync New Names" and "Full Refresh" buttons in Settings.

---

### `ghl-webhook`

**Purpose:** Receives webhook events from GoHighLevel and inserts them into the `ghl_events` table.

| Step | Action |
|---|---|
| 1 | Parse the incoming POST body as JSON |
| 2 | Verify the webhook signature using GHL's RSA public key (warns but doesn't reject on failure) |
| 3 | Extract `locationId`, `userId`, `contactId`, `eventDate`, `webhookId` from the payload |
| 4 | Insert a row into `ghl_events` using the service_role key |
| 5 | The `auto_fill_event_tenant_id` trigger auto-assigns `tenant_id` |

**Webhook dedup:** The `webhook_id` column has a unique index. If GHL resends a webhook, the insert fails with a duplicate key error (code `23505`) and the function returns `{ ok: true, duplicate: true }`.

**Supported events:** All 26 GHL event types defined in `EVENT_USER_FIELD` (appointments, contacts, messages, tasks, opportunities, notes, locations).

**Field extraction:** Each event type has a different field mapping for `user_id`:
- Appointments → `assignedUserId` (nested under `.appointment`)
- Contacts/Tasks/Opportunities → `assignedTo`
- Messages/Conversations/Notes → `userId`
- Locations → no user field

**Security:** Always returns HTTP 200 to prevent GHL retry storms, even on errors.

**Deployment:**
```bash
supabase functions deploy ghl-webhook --no-verify-jwt
```

---

### `create-user`

**Purpose:** Admin user creation. Only tenant owners can create new auth users.

| Step | Action |
|---|---|
| 1 | Verify caller is authenticated |
| 2 | Verify caller is `owner` role in their tenant |
| 3 | Create a new Supabase Auth user with `email_confirm: true` |

**Request:** `POST` with body `{ email: "...", password: "..." }`

---

## Frontend Architecture

### Provider Hierarchy

```tsx
<ErrorBoundary>
  <QueryClientProvider>          // TanStack React Query
    <ThemeProvider>               // Dark/Light theme
      <AuthProvider>              // User + Tenant context
        <TooltipProvider>
          <Toaster /> <Sonner />  // Toast notifications
          <BrowserRouter>
            <Routes>
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/*" element={
                <FiltersProvider>   // Date range + filter state
                  <AppLayout>       // Sidebar + Topbar
                    <Routes>...</Routes>
                  </AppLayout>
                </FiltersProvider>
              } />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
</ErrorBoundary>
```

### Route Map

| Path | Component | Description |
|---|---|---|
| `/auth` | `Auth.tsx` | Login / Sign up (unprotected) |
| `/` | `Overview.tsx` | Main dashboard with KPIs, charts, leaderboards |
| `/locations` | `Locations.tsx` | Location list with health monitoring |
| `/locations/:locationId` | `LocationDetail.tsx` | Individual location analytics |
| `/users` | `Users.tsx` | User list with search, sort, status pills |
| `/users/:userId` | `UserDetail.tsx` | Individual user analytics |
| `/alerts` | `Alerts.tsx` | Alert management (coming soon) |
| `/reports` | `Reports.tsx` | Report generation (coming soon) |
| `/settings` | `Settings.tsx` | GHL integration, sync, thresholds |
| `*` | `NotFound.tsx` | 404 page |

### Layout Components

- **`AppLayout`** — Wraps protected routes. Shows `TenantSetup` if no tenant exists. Contains sidebar + topbar + main content area.
- **`AppSidebar`** — Sectioned navigation (Analytics: Overview/Locations/Users, Operations: Alerts/Reports). Footer has Settings link + user email + logout button. Responsive: overlay on mobile, static on desktop.
- **`Topbar`** — Period selector (1d/7d/30d toggle), date range display, theme toggle (sun/moon), mobile menu button.

---

## Hooks Reference

### `useAuth()` → `AuthContextValue`

```ts
interface AuthContextValue {
  user: User | null;          // Supabase Auth user
  tenant: Tenant | null;      // Resolved tenant object
  tenantMode: TenantMode | null;  // 'agency' | 'single_location'
  loading: boolean;
  signOut: () => Promise<void>;
}
```

Resolves the tenant by querying `tenant_members → tenants` after login. Sets `loading: false` once both auth and tenant are resolved.

---

### `useFilters()` → `FiltersContextValue`

```ts
interface FiltersContextValue {
  dateRange: DateRange;        // { from: Date, to: Date }
  setDateRange: (range) => void;
  preset: string;              // '1d' | '7d' | '30d'
  setPreset: (p) => void;     // Auto-updates dateRange
  locationFilter: string | null;
  setLocationFilter: (id) => void;
  userFilter: string | null;
  setUserFilter: (id) => void;
  searchQuery: string;
  setSearchQuery: (q) => void;
}
```

Default: last 7 days. The `setPreset()` method auto-calculates the corresponding date range.

---

### `useTrackerSessions()` → React Query result

Fetches `tracker_page_sessions` filtered by the current `dateRange` from `useFilters()`. Returns up to 5,000 rows ordered by `started_at DESC`.

**Query key:** `['tracker-sessions', from.toISOString(), to.toISOString()]`

---

### `useGhlUserNames()` / `useGhlLocationNames()` → `Map<string, string>`

Returns a `Map` of GHL ID → human-readable name from the cache tables. Used everywhere to resolve IDs to names.

**Stale time:** 5 minutes

> ⚠️ These return `Map` objects, not arrays. Use `.size` (not `.length`) and `.get(id)` (not indexing).

---

### `useGhlConnection()` → React Query result

Checks if a GHL OAuth token exists for the current tenant.

```ts
// When connected:
{ connected: true, locationId: string, expiresAt: string, updatedAt: string, isExpired: boolean }

// When not connected:
{ connected: false }
```

**Stale time:** 30 seconds

---

### `getGhlConnectUrl(tenantId, redirectUrl)` → string

Builds the full GHL OAuth URL with encoded state (tenant_id + redirect_url).

---

### `useSettings()` / `useUpdateSettings()`

- `useSettings()` — Fetches the `settings` row for the current tenant.
- `useUpdateSettings()` — Mutation that upserts settings. Invalidates the query on success.

---

### `useTheme()` → `{ theme: 'dark' | 'light', toggle: () => void }`

Persists to `localStorage` key `spark-theme`. Toggles the `dark` class on `<html>`.

---

## Helpers & Utilities

### `src/lib/helpers.ts`

| Function | Description |
|---|---|
| `normalizePagePath(path)` | Replaces UUIDs and numeric IDs with `:id` for grouping. e.g. `/location/abc-123/contacts` → `/location/:id/contacts` |
| `categorizePagePath(path)` | Maps GHL paths to categories: Dashboard, Conversations, Contacts, Opportunities, Calendars, Automations, Reporting, Settings, Marketing, Media, Other |
| `formatDuration(seconds)` | `330` → `"5m 30s"`, `7200` → `"2h"` |
| `formatMinutes(minutes)` | `90` → `"1h 30m"` |
| `formatNumber(n)` | Adds locale-specific commas |
| `formatPercent(value)` | `12.345` → `"12.3%"` |
| `formatShortId(id)` | Truncates IDs to 10 chars + ellipsis |
| `isBounce(durationSeconds)` | Returns `true` if duration < `BOUNCE_THRESHOLD_SECONDS` (default: 10) |
| `resolveName(map, id)` | Looks up a GHL ID in a name cache `Map`, falls back to raw ID |

### `src/lib/constants.ts`

| Constant | Value |
|---|---|
| `SUPABASE_URL` | Project URL (env fallback) |
| `SUPABASE_ANON_KEY` | Public key (env fallback) |
| `GHL_CLIENT_ID` | `699794ea6024a01b65625f88-mlu2gmon` |
| `GHL_MARKETPLACE_URL` | `https://marketplace.leadconnectorhq.com/oauth/chooselocation` |
| `GHL_SCOPES` | All OAuth scopes (locations, calendars, conversations, contacts, tasks, tags, opportunities) |
| `TRACKER_TABLE` | `'tracker_page_sessions'` |
| `BOUNCE_THRESHOLD_SECONDS` | `10` |

### `src/lib/sync-ghl.ts`

Client-side function that invokes the `sync-ghl-names` edge function. Used by the Settings page.

```ts
syncGhlNames(forceRefresh?: boolean): Promise<SyncResult>
```

### `src/lib/utils.ts`

```ts
cn(...inputs: ClassValue[]): string  // clsx + tailwind-merge
```

---

## Pages Reference

### Overview (`/`)

The main dashboard. Computes all metrics client-side from `useTrackerSessions()`:

- **KPI Cards:** Total active minutes, sessions count, unique users, unique locations (each with a different accent color)
- **Area Chart:** Daily session activity (7-day or 30-day trend)
- **Donut Chart:** Page category breakdown (Dashboard, Contacts, Conversations, etc.)
- **Feature Usage:** Animated progress bars showing adoption per category
- **User Leaderboard:** Top 5 users by total active time
- **Location Leaderboard:** Top 5 locations by total active time
- **GHL Activity:** Expandable event summary cards showing categorized GHL webhook events (Appointments, Contacts, Messages & Calls, Opportunities, Tasks, Notes, Locations) with dedup logic and message channel breakdown
- **GHL Warning Banner:** Shows if GHL is not connected

Uses `categorizePagePath()` to group raw paths into categories for the donut chart and feature usage bars.

### Users (`/users`)

- **KPI Cards:** Total users, active users, avg time per user
- **Search:** Client-side filter on user name/ID
- **Sortable Table:** User name, sessions, total time, avg session, status
- **Status Pills:** Active (≥30m total), Low Usage (≥5m), Inactive (<5m)
- Links to `/users/:userId`

### UserDetail (`/users/:userId`)

- **Profile Header:** Avatar with initials, user name, ID
- **KPI Cards:** Total time, sessions, pages visited, avg session
- **Daily Activity Chart:** Area chart of daily minutes
- **Feature Usage:** Progress bars per category
- **Recent Sessions:** Timeline of last 20 sessions

### Locations (`/locations`)

- **KPI Cards:** Total locations, healthy locations, avg time per location
- **Search:** Client-side filter
- **Sortable Table:** Location name, users count, sessions, total time, health
- **Health Pills:** Healthy (≥60m), At Risk (≥15m), Critical (<15m)
- Links to `/locations/:locationId`

### LocationDetail (`/locations/:locationId`)

- **Health Header:** Shield icon colored by health status
- **KPI Cards:** Total time, sessions, unique users, avg session
- **Daily Activity Chart:** Green gradient area chart
- **Users List:** All users at this location with links
- **Feature Usage:** Progress bars per category

### Settings (`/settings`)

- **GHL Integration Card:**
  - Connection status pill (connected/expired/not connected)
  - Connect/Disconnect buttons
  - Cached name counts (locations + users)
  - Sync buttons (incremental + full refresh)
  - Sync result feedback
- **Activity Events:** Toggle visibility of each GHL event type, organized by category (Appointments, Contacts, Messages & Calls, Opportunities, Tasks, Notes, Locations). Changes persist to `settings.enabled_events` and affect all dashboard views.
- **Alert Thresholds:** Bounce threshold, inactivity days, minimum weekly minutes
- **Timezone:** Timezone configuration

### Auth (`/auth`)

- Email/password login and signup
- Toggle between sign-in and sign-up modes
- Error display with styled box
- Redirect to `/` on successful auth

### Alerts (`/alerts`) — Coming Soon

- Filter chips by severity (Info, Warning, Error, Success)
- Premium empty state

### Reports (`/reports`) — Coming Soon

- Report cards: Location Report, User Report, Adoption Report, Alert Summary
- "Coming Soon" notice

---

## Component Library

### Custom Components

| Component | Path | Description |
|---|---|---|
| `EventSummaryCards` | `components/dashboard/EventSummaryCards.tsx` | Categorized GHL event cards with expandable detail, dedup logic, and message channel breakdown |
| `KpiCard` | `components/dashboard/KpiCard.tsx` | Metric card with icon, value, subtitle, trend badge, customizable accent color |
| `GhlWarningBanner` | `components/dashboard/GhlWarningBanner.tsx` | Inline warning when GHL is not connected |
| `NavLink` | `components/NavLink.tsx` | React Router NavLink with `activeClassName` support |
| `TenantSetup` | `components/TenantSetup.tsx` | First-run workspace setup UI |
| `ErrorBoundary` | `components/ErrorBoundary.tsx` | Global error boundary |

### shadcn/ui Components (in `components/ui/`)

All standard shadcn/ui components are available. Key ones used:

- `Button` — with variants: `default`, `outline`, `ghost`, `destructive`, `link`
- `Input` — styled form input
- `Label` — form labels
- `Card` — content containers
- `Skeleton` — loading placeholders
- `Tabs` — tabbed interfaces
- `Toast/Toaster` — notifications

---

## Design System

### CSS Variables (`index.css`)

The app uses HSL-based CSS custom properties for theming:

```css
:root {                                    /* Dark theme (default) */
  --background: 222 47% 6%;               /* Deep navy-black */
  --foreground: 210 40% 96%;
  --primary: 199 89% 48%;                 /* Cyan blue */
  --card: 222 40% 9%;
  --border: 215 25% 18%;
  --muted: 215 25% 15%;
}
```

### CSS Classes

| Class | Description |
|---|---|
| `.glass-card` | Glassmorphism card with backdrop blur + subtle border |
| `.glass-sidebar` | Sidebar glassmorphism variant |
| `.nav-item` | Sidebar navigation link with hover states |
| `.nav-item.active` | Active nav link with cyan left border indicator |
| `.metric-card` | KPI card with radial glow on hover |
| `.glow-primary` | Subtle cyan glow effect |
| `.status-pill` | Rounded pill badge for statuses |
| `.data-table` | Styled table with hover rows |
| `.progress-bar` | Custom animated progress bar |
| `.animate-fade-in` | Fade-in on mount |
| `.animate-slide-up` | Slide-up on mount |

### Animation Pattern

Pages use staggered entrance animations:

```tsx
// KPI cards receive ascending animation delays:
style={{ animationDelay: `${index * 100}ms` }}
```

---

## Deployment

### Deploy Edge Functions

```bash
supabase functions deploy sync-ghl-names --no-verify-jwt
supabase functions deploy bootstrap-tenant --no-verify-jwt
supabase functions deploy create-user --no-verify-jwt
supabase functions deploy integration-callback --no-verify-jwt
```

### Set Secrets

```bash
supabase secrets set GHL_CLIENT_ID=699794ea6024a01b65625f88-mlu2gmon
supabase secrets set GHL_CLIENT_SECRET=<your-secret-here>
```

### Run Migrations

**Migration 001** — `supabase/migrations/001_production_refactor.sql`:
1. Adds `tenant_id` to `tracker_page_sessions`
2. Backfills existing rows via `ghl_cache_locations` and `ghl_oauth_tokens`
3. Creates the `auto_fill_tenant_id` trigger
4. Creates performance indexes
5. Sets up all RLS policies
6. Creates RPC functions (`get_unique_ghl_ids`, `get_uncached_ghl_ids`)
7. Seeds default settings

**Migration 002** — `supabase/migrations/002_fix_tenant_isolation.sql`:
1. Fixes the `auto_fill_tenant_id` trigger (removes blanket fallback)
2. Resets mis-assigned sessions to NULL
3. Re-backfills using valid mappings only
4. Creates `backfill_orphaned_sessions` RPC function

**Migration 004** — `supabase/migrations/004_add_company_id_and_fix_policies.sql`:
1. Adds `company_id` column to `ghl_oauth_tokens`
2. Drops the old permissive `authenticated_select_tracker_page_sessions` policy (root cause of data leak)
3. Drops duplicate `anon_insert_tracker_page_sessions` policy

**Migration 005** — `supabase/migrations/005_ghl_events.sql`:
1. Creates `ghl_events` table for storing GHL webhook events
2. Adds indexes for dashboard queries (by tenant+date, type, user, location)
3. Adds unique index on `webhook_id` for dedup
4. Sets up tenant-scoped RLS policy
5. Creates `auto_fill_event_tenant_id` trigger (same pattern as tracker sessions)
6. Adds `enabled_events` JSONB column to `settings` table with defaults

**Migration 006** — `supabase/migrations/006_fix_tenant_assignment.sql`:
1. One-time fix for tenant_id mismatch where GHL data was assigned to an orphaned tenant
2. Reassigns all `ghl_cache_locations`, `ghl_cache_users`, `ghl_events`, `tracker_page_sessions`, and `settings` to the correct tenant
3. Cleans up orphaned OAuth tokens and tenant records

### Build & Deploy Frontend

```bash
npm run build
# Deploy dist/ to your hosting provider (Vercel, Netlify, etc.)
```

---

## Common Gotchas

### 1. RLS Silent Denials
Supabase RLS silently returns 0 rows (no error) when a policy denies access. If a mutation seems to succeed but nothing changes, check that the required RLS policy exists for that operation (SELECT, INSERT, UPDATE, DELETE).

### 2. GHL Name Cache Returns `Map`, Not `Array`
`useGhlUserNames()` and `useGhlLocationNames()` return `Map<string, string>`. Use `.size` (not `.length`) and `.get(id)` (not bracket indexing).

### 3. Tracker Script Uses Anon Key
The tracker script posts data using the anon key without user authentication. The `anon_insert_sessions` RLS policy explicitly allows this. Never remove this policy or tracking will break.

### 4. Tenant Auto-Fill Trigger & Orphaned Sessions
New sessions from the tracker script have `tenant_id = NULL`. The DB trigger `auto_fill_tenant_id` fills this by looking up the `location_id` in `ghl_cache_locations` → `ghl_oauth_tokens`. If no mapping exists, `tenant_id` stays NULL and the session is **invisible to all tenants** (RLS enforces this). This means:
- A new tenant with no GHL connection sees an **empty dashboard** (correct).
- When the tenant connects GHL and runs sync, historical orphaned sessions are **automatically backfilled** via the `backfill_orphaned_sessions` RPC.
- Sessions for completely unknown locations stay orphaned until someone connects and syncs that location.

### 5. Token Refresh
The `sync-ghl-names` edge function auto-refreshes GHL tokens that are within 5 minutes of expiry. The refreshed tokens are saved back to `ghl_oauth_tokens`. No manual intervention needed.

### 6. CSS @tailwind Lint Warnings
The IDE may show "Unknown at rule @tailwind" and "Unknown at rule @apply" warnings in `index.css`. These are false positives — Tailwind v3 with PostCSS processes these at build time. They do not affect the build.

### 7. Edge Function Deno Lint Warnings
Edge functions use `Deno.serve()` and `https://esm.sh/` imports which are only valid in the Deno runtime. The IDE's TypeScript checker flags these as errors. They compile and run fine on Supabase's edge runtime.

### 8. React Query Cache & Multi-Tenant
When switching accounts in the same browser, React Query will serve stale cached data from the previous account unless the cache is cleared. The `AuthProvider` handles this by calling `queryClient.clear()` on `SIGNED_OUT` and `SIGNED_IN` auth events. If you add new cached queries, ensure their data is tenant-scoped via RLS — the cache clear on auth change will handle invalidation.

### 9. Session Data Limit
`useTrackerSessions()` fetches up to **5,000 rows** per query. For high-traffic installations, consider adding server-side aggregation or pagination.

### 10. GHL Event Dedup Logic
When GHL creates an entity (e.g. Appointment, Contact), it also fires an Update event within ~10 seconds with the same entity ID. The `EventSummaryCards` component detects these "ghost" updates by comparing entity IDs and timestamps within a 10-second window and subtracts them from the total count. This logic is defined per category via the `dedup` property in `CATEGORIES`.

### 11. GHL Events Storage Growth
The `ghl_events` table stores the full webhook payload (`event_data` JSONB column, 500B–5KB per row) and grows unboundedly. At scale (~230 locations, ~50 events/day each), this can reach ~1.7 GB/month. A planned refactor will replace this with daily aggregated summaries. See `docs/PLAN_event_summarization.md` for the full plan.

### 12. Tenant ID Mismatch
If GHL locations are connected under one tenant but the user logs in under a different tenant, RLS silently returns 0 events. This happened when the OAuth flow created a new tenant instead of reusing the existing one. Migration 006 fixes this specific case. To diagnose: compare `tenant_id` in `tenant_members` (for the user) vs `ghl_cache_locations` (for the location).
