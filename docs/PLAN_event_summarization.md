# GHL Event Summarization — Implementation Plan

> **Goal:** Replace the raw `ghl_events` table (which grows unboundedly and stores the full GHL webhook payload per event) with a compact `ghl_event_daily_summary` table that aggregates counts by **location + event_type + day**. After migration, delete all raw events to reclaim storage.

---

## Current State

### `ghl_events` table schema

| Column       | Type        | Size concern |
|-------------|-------------|--------------|
| `id`         | uuid        | 16 B         |
| `tenant_id`  | uuid        | 16 B         |
| `location_id`| text        | ~20 B        |
| `event_type` | text        | ~25 B        |
| `user_id`    | text        | ~26 B        |
| `contact_id` | text        | ~26 B        |
| **`event_data`** | **jsonb** | **500 B – 5+ KB** ← the big one |
| `event_date` | timestamptz | 8 B          |
| `webhook_id` | text        | ~36 B        |
| `created_at` | timestamptz | 8 B          |

**Estimated row size:** ~700 B – 5 KB each.  
**At 231 locations × ~50 events/day:** ~11,550 rows/day → ~350K rows/month → ~1.7 GB/month.

### The dashboard only needs **counts per location per day per event_type**

The `EventSummaryCards` component groups events by `event_type`, counts them, and optionally applies dedup logic. It never reads `event_data` except for:
- `messageType` (SMS/Call/Email) in the message breakdown
- Entity IDs for dedup (comparing timestamps)

Both of these can be pre-computed into the summary row.

---

## Target State

### New table: `ghl_event_daily_summary`

```sql
CREATE TABLE public.ghl_event_daily_summary (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id),
  location_id    text NOT NULL,
  event_date     date NOT NULL,           -- truncated to day
  event_type     text NOT NULL,           -- e.g. 'AppointmentCreate'
  event_count    integer NOT NULL DEFAULT 0,
  -- Message channel breakdown (only populated for InboundMessage/OutboundMessage)
  sms_count      integer DEFAULT 0,
  call_count     integer DEFAULT 0,
  email_count    integer DEFAULT 0,
  other_count    integer DEFAULT 0,
  -- User breakdown: top users for this event type on this day
  user_counts    jsonb DEFAULT '{}'::jsonb, -- { "userId1": 5, "userId2": 3 }
  -- Dedup metadata
  dedup_ghost_count integer DEFAULT 0,     -- pre-computed ghost count
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

-- Composite unique: one row per tenant+location+date+event_type
CREATE UNIQUE INDEX idx_daily_summary_upsert
  ON public.ghl_event_daily_summary(tenant_id, location_id, event_date, event_type);

-- Query indexes
CREATE INDEX idx_daily_summary_date
  ON public.ghl_event_daily_summary(tenant_id, event_date DESC);

CREATE INDEX idx_daily_summary_location
  ON public.ghl_event_daily_summary(tenant_id, location_id, event_date DESC);
```

**Estimated row size:** ~200 B  
**At 231 locations × 25 event types × 1 row/day:** ~5,775 rows/day → ~173K rows/month → **~35 MB/month** (50× less than raw events!)

---

## Phases

### Phase 1: Create Summary Table + RLS

1. Write migration `007_event_daily_summary.sql`:
   - Create `ghl_event_daily_summary` table
   - Add RLS policies (same tenant-scoped pattern)
   - Add upsert function `upsert_event_summary()` for the webhook to call

2. RLS policy:
   ```sql
   CREATE POLICY "tenant_select_daily_summary" ON public.ghl_event_daily_summary
     FOR SELECT TO authenticated USING (
       tenant_id IN (
         SELECT tenant_id FROM public.tenant_members
         WHERE user_id = auth.uid()
       )
     );
   ```

---

### Phase 2: Backfill Historical Data

Write a SQL function to aggregate existing `ghl_events` into the summary table:

```sql
INSERT INTO public.ghl_event_daily_summary
  (tenant_id, location_id, event_date, event_type, event_count,
   sms_count, call_count, email_count, other_count, user_counts)
SELECT
  tenant_id,
  location_id,
  (event_date AT TIME ZONE 'UTC')::date AS event_date,
  event_type,
  COUNT(*) AS event_count,
  -- Message breakdown
  COUNT(*) FILTER (WHERE event_data->>'messageType' ILIKE 'sms') AS sms_count,
  COUNT(*) FILTER (WHERE event_data->>'messageType' ILIKE 'call') AS call_count,
  COUNT(*) FILTER (WHERE event_data->>'messageType' ILIKE 'email') AS email_count,
  COUNT(*) FILTER (WHERE event_type IN ('InboundMessage','OutboundMessage')
    AND COALESCE(event_data->>'messageType','') NOT ILIKE ANY(ARRAY['sms','call','email'])) AS other_count,
  -- User counts as JSONB
  jsonb_object_agg(
    COALESCE(sub.user_id, '_none'),
    sub.user_event_count
  ) AS user_counts
FROM (
  SELECT
    tenant_id, location_id, event_type,
    (event_date AT TIME ZONE 'UTC')::date AS event_date,
    COALESCE(user_id, '_none') AS user_id,
    COUNT(*) AS user_event_count
  FROM public.ghl_events
  WHERE tenant_id IS NOT NULL
  GROUP BY tenant_id, location_id, event_type,
           (event_date AT TIME ZONE 'UTC')::date, user_id
) sub
GROUP BY sub.tenant_id, sub.location_id, sub.event_date, sub.event_type
ON CONFLICT (tenant_id, location_id, event_date, event_type)
DO UPDATE SET
  event_count = EXCLUDED.event_count,
  sms_count   = EXCLUDED.sms_count,
  call_count  = EXCLUDED.call_count,
  email_count = EXCLUDED.email_count,
  other_count = EXCLUDED.other_count,
  user_counts = EXCLUDED.user_counts,
  updated_at  = now();
```

---

### Phase 3: Update Webhook Edge Function (`ghl-webhook/index.ts`)

Modify the webhook handler to **upsert into the summary table** instead of (or in addition to) the raw events table:

**Option A — Direct replace (recommended):**
- Stop inserting into `ghl_events` entirely
- Upsert into `ghl_event_daily_summary` with `ON CONFLICT` increment:
  ```sql
  INSERT INTO ghl_event_daily_summary (tenant_id, location_id, event_date, event_type, event_count, ...)
  VALUES ($1, $2, $3::date, $4, 1, ...)
  ON CONFLICT (tenant_id, location_id, event_date, event_type)
  DO UPDATE SET
    event_count = ghl_event_daily_summary.event_count + 1,
    sms_count = ghl_event_daily_summary.sms_count + CASE WHEN $messageType = 'SMS' THEN 1 ELSE 0 END,
    ...
    updated_at = now();
  ```
- The `user_counts` JSONB field gets updated:
  ```sql
  user_counts = jsonb_set(
    ghl_event_daily_summary.user_counts,
    ARRAY[$userId],
    to_jsonb(COALESCE((ghl_event_daily_summary.user_counts->>$userId)::int, 0) + 1)
  )
  ```
- Webhook dedup via `webhook_id` can be handled with a lightweight `ghl_webhook_ids` set or a bloom filter, OR we simply accept minor overcounting (webhooks rarely duplicate when returning 200).

**Option B — Dual-write with TTL (safer, phased):**
- Keep inserting raw events AND upsert summaries
- Add a cron or Supabase pg_cron job to delete raw events older than 7 days
- This gives a grace period to validate the summary data  
- _Not recommended long-term due to complexity_

---

### Phase 4: Update Frontend

#### 4a. New hook: `useGhlEventSummary`

Replace `useGhlEvents` with a new hook that fetches from `ghl_event_daily_summary`:

```ts
export interface GhlEventSummary {
  location_id: string;
  event_date: string;      // YYYY-MM-DD
  event_type: string;
  event_count: number;
  sms_count: number;
  call_count: number;
  email_count: number;
  other_count: number;
  user_counts: Record<string, number>;
  dedup_ghost_count: number;
}

export function useGhlEventSummary(opts?: { userId?: string; locationId?: string }) {
  const { dateRange } = useFilters();
  
  return useQuery({
    queryKey: ['ghl-event-summary', dateRange.from, dateRange.to, opts?.userId, opts?.locationId],
    queryFn: async () => {
      let query = supabase
        .from('ghl_event_daily_summary')
        .select('*')
        .gte('event_date', dateRange.from.toISOString().slice(0, 10))
        .lte('event_date', dateRange.to.toISOString().slice(0, 10));
      
      if (opts?.locationId) query = query.eq('location_id', opts.locationId);
      // For user filtering, we'll filter client-side from user_counts
      
      const { data, error } = await query;
      if (error) throw error;
      return data as GhlEventSummary[];
    },
  });
}
```

#### 4b. Update `EventSummaryCards`

The component currently works with individual `GhlEvent[]` — it needs to accept pre-aggregated data instead:

- **Input change:** `events: GhlEvent[]` → `summaries: GhlEventSummary[]`
- **Counting:** Instead of `.length` on filtered arrays, sum `event_count` fields
- **Message breakdown:** Read `sms_count`, `call_count`, `email_count`, `other_count` from summary rows
- **Dedup:** Read `dedup_ghost_count` from summary (pre-computed) instead of doing client-side entity ID matching
- **User filtering:** If filtering by user, extract that user's count from `user_counts` JSONB

#### 4c. Update Pages

- `Overview.tsx` — switch from `useEnabledGhlEvents()` to `useGhlEventSummary()`
- `UserDetail.tsx` — same
- `LocationDetail.tsx` — same

---

### Phase 5: Delete Raw Events + Drop Table

After confirming the summary pipeline works correctly:

1. **Delete all rows:**
   ```sql
   TRUNCATE public.ghl_events;
   ```

2. **Drop the table (optional, can keep empty as insurance):**
   ```sql
   DROP TABLE IF EXISTS public.ghl_events;
   ```

3. **Remove the old webhook insert code** from `ghl-webhook/index.ts`

4. **Clean up:**
   - Remove `GhlEvent` interface
   - Remove `useGhlEvents()` and `useEnabledGhlEvents()` hooks  
   - Remove old dedup logic from `EventSummaryCards`
   - Delete migration 005 reference from README

---

## Dedup Strategy in Summary Table

The current dedup logic identifies "ghost" Update events within 10s of a Create event for the same entity. In the summarized world we have two options:

**Option A — Pre-compute at webhook time (recommended):**
- In the webhook handler, when receiving an Update event, check if a Create event for the same entity was received in the last 10s by querying `ghl_events` (or a small recent-events buffer).
- If it's a ghost: increment `dedup_ghost_count` but NOT `event_count`.
- **Trade-off:** Requires a brief lookup; fast since it's only checking very recent rows.

**Option B — Drop dedup entirely:**
- The dedup only removes ~5-10% of events (ghost updates).  
- We could show raw counts and note the slight overcounting.
- **Simplest approach**, but loses the accuracy the current UI provides.

**Recommendation:** Start with Option B (drop dedup) for simplicity, and add Option A later if users notice the difference.

---

## Webhook Dedup (webhook_id)

Currently the `ghl_events` table has a unique index on `webhook_id` to prevent processing the same webhook twice. With the summary table:

- Incrementing a counter is **idempotent-ish** but not perfectly — a duplicate webhook would increment twice.
- **Options:**
  1. Keep a small `ghl_processed_webhooks` table with just `webhook_id` + `processed_at`, with a TTL job to purge rows > 24h.
  2. Accept very rare double-counting (GHL rarely re-sends if we return 200).
  3. Use a Redis/memory cache if available (not available in edge functions).

**Recommendation:** Option 1 — a tiny lookup table is cheap and provides correctness.

---

## Migration Checklist

- [x] Phase 1: Create `ghl_event_daily_summary` table + indexes + RLS
- [x] Phase 2: Run backfill SQL to aggregate existing events
- [x] Phase 3: Update `ghl-webhook/index.ts` to upsert summaries
- [x] Phase 3b: Create `ghl_processed_webhooks` dedup table (skipped - sticking to dual writing in phase 3)
- [x] Phase 4a: Create `useGhlEventSummary` hook
- [x] Phase 4b: Refactor `EventSummaryCards` to work with summaries
- [x] Phase 4c: Update Overview, UserDetail, LocationDetail pages
- [x] Phase 5: Validate data, then truncate/drop `ghl_events` (using a 7 day rolling buffer deletion with pg_cron)
- [x] Update README.md with new schema documentation

---

## Storage Savings Estimate

| Metric | Before (raw) | After (summary) | Savings |
|--------|-------------|-----------------|---------|
| Rows/day | ~11,550 | ~5,775 | 50% fewer rows |
| Avg row size | ~2 KB | ~200 B | 10× smaller |
| Monthly storage | ~700 MB | ~1.1 MB | **~99.8%** |
| Query performance | Scan 11K+ rows | Scan ~170 rows | **~65× faster** |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Data loss during migration | Cannot recover raw event details | Run backfill first, verify counts match before truncating |
| Dedup accuracy drops | 5-10% overcounting on some categories | Acceptable; add dedup later if needed |
| User-level filtering less granular | Can't filter events by contact_id anymore | `user_counts` JSONB preserves per-user breakdowns |
| Webhook duplicate processing | Rare double-counting | `ghl_processed_webhooks` table for dedup |
| Timezone edge cases | Day boundaries may shift events | Use tenant timezone for date truncation |
