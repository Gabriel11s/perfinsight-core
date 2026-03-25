-- =================================================================
-- 023_category_summary.sql
-- Add page_category dimension to tracker session daily summaries
--
-- Problem: tracker_session_daily_summary aggregated by
-- (tenant, location, user, date) only. The frontend had no
-- category breakdown for historical data, so Feature Usage
-- showed everything as "Other" on 7d/30d views.
--
-- Solution:
-- 1. Add page_category column (mirrors categorizePagePath in helpers.ts)
-- 2. Create a SQL equivalent of the frontend categorizePagePath()
-- 3. Update the rollup function to GROUP BY category
-- 4. Backfill all historical data with category breakdowns
-- 5. Update the unique constraint to include page_category
-- =================================================================


-- ─────────────────────────────────────────────────────────────────
-- SECTION 1: SQL mirror of categorizePagePath() from helpers.ts
--
-- IMPORTANT: If categorizePagePath() in src/lib/helpers.ts is ever
-- updated, this function must be updated in a new migration to match.
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.categorize_page_path(p_page_path text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(p_page_path) LIKE '%/dashboard%'                              THEN 'Dashboard'
    WHEN lower(p_page_path) LIKE '%/conversations%'                          THEN 'Conversations'
    WHEN lower(p_page_path) LIKE '%/contacts%'                               THEN 'Contacts'
    WHEN lower(p_page_path) LIKE '%/opportunities%'
      OR lower(p_page_path) LIKE '%/funnels%'                                THEN 'Opportunities'
    WHEN lower(p_page_path) LIKE '%/calendars%'
      OR lower(p_page_path) LIKE '%/calendar%'                               THEN 'Calendars'
    WHEN lower(p_page_path) LIKE '%/automation%'
      OR lower(p_page_path) LIKE '%/workflows%'                              THEN 'Automations'
    WHEN lower(p_page_path) LIKE '%/reporting%'
      OR lower(p_page_path) LIKE '%/reports%'                                THEN 'Reporting'
    WHEN lower(p_page_path) LIKE '%/settings%'
      OR lower(p_page_path) LIKE '%/setup%'                                  THEN 'Settings'
    WHEN lower(p_page_path) LIKE '%/marketing%'                              THEN 'Marketing'
    WHEN lower(p_page_path) LIKE '%/media%'                                  THEN 'Media'
    ELSE 'Other'
  END
$$;

COMMENT ON FUNCTION public.categorize_page_path(text) IS
  'SQL mirror of categorizePagePath() in src/lib/helpers.ts. '
  'Maps a GHL page path to its feature category. Must be kept in sync '
  'with the frontend function. Used by the daily summary rollup.';


-- ─────────────────────────────────────────────────────────────────
-- SECTION 2: Add page_category column
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE public.tracker_session_daily_summary
  ADD COLUMN IF NOT EXISTS page_category text NOT NULL DEFAULT 'Other';


-- ─────────────────────────────────────────────────────────────────
-- SECTION 3: Replace unique constraint to include page_category
--
-- The auto-generated name for UNIQUE(tenant_id,location_id,user_id,date)
-- was truncated by PostgreSQL's 63-byte identifier limit to:
--   tracker_session_daily_summary_tenant_id_location_id_user_id_key
-- Drop both the real name and the new constraint (idempotent re-run).
-- ─────────────────────────────────────────────────────────────────

-- Drop old 4-column constraint (actual truncated name in production)
ALTER TABLE public.tracker_session_daily_summary
  DROP CONSTRAINT IF EXISTS tracker_session_daily_summary_tenant_id_location_id_user_id_key;

-- Drop new constraint if this migration already ran partially
ALTER TABLE public.tracker_session_daily_summary
  DROP CONSTRAINT IF EXISTS tracker_session_daily_summary_unique;

ALTER TABLE public.tracker_session_daily_summary
  ADD CONSTRAINT tracker_session_daily_summary_unique
  UNIQUE (tenant_id, location_id, user_id, date, page_category);

-- Index for category filtering
CREATE INDEX IF NOT EXISTS idx_tss_category
  ON public.tracker_session_daily_summary (tenant_id, date, page_category);


-- ─────────────────────────────────────────────────────────────────
-- SECTION 4: Update rollup function to group by page_category
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.upsert_tracker_summary_for_date(p_target_date DATE)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO public.tracker_session_daily_summary (
        tenant_id,
        location_id,
        user_id,
        date,
        page_category,
        total_duration_seconds,
        session_count,
        bounce_count
    )
    SELECT
        tenant_id,
        location_id,
        user_id,
        (started_at AT TIME ZONE 'UTC')::date                                AS date,
        public.categorize_page_path(COALESCE(page_path, ''))                 AS page_category,
        SUM(COALESCE(duration_seconds, 0))::integer                          AS total_duration_seconds,
        COUNT(*)::integer                                                     AS session_count,
        COUNT(*) FILTER (WHERE COALESCE(duration_seconds, 0) < 10)::integer  AS bounce_count
    FROM
        public.tracker_page_sessions
    WHERE
        tenant_id IS NOT NULL
        AND user_id IS NOT NULL
        AND location_id IS NOT NULL
        AND (started_at AT TIME ZONE 'UTC')::date = p_target_date
    GROUP BY
        tenant_id,
        location_id,
        user_id,
        (started_at AT TIME ZONE 'UTC')::date,
        public.categorize_page_path(COALESCE(page_path, ''))
    ON CONFLICT (tenant_id, location_id, user_id, date, page_category)
    DO UPDATE SET
        total_duration_seconds = EXCLUDED.total_duration_seconds,
        session_count          = EXCLUDED.session_count,
        bounce_count           = EXCLUDED.bounce_count,
        updated_at             = timezone('utc'::text, now());
END;
$$;

COMMENT ON FUNCTION public.upsert_tracker_summary_for_date(date) IS
  'Rolls up tracker_page_sessions into tracker_session_daily_summary '
  'for a given date. Groups by (tenant, location, user, date, page_category) '
  'so the frontend can show per-category breakdowns on 7d/30d views. '
  'Called nightly by pg_cron at 01:00 UTC.';


-- ─────────────────────────────────────────────────────────────────
-- SECTION 5: Backfill all historical data with category breakdown
--
-- Truncate first to avoid conflict with the old (no-category) rows,
-- then re-run the rollup for every date that has raw sessions.
-- ─────────────────────────────────────────────────────────────────

TRUNCATE TABLE public.tracker_session_daily_summary;

DO $$
DECLARE
    r RECORD;
    n_dates integer := 0;
BEGIN
    FOR r IN
        SELECT DISTINCT (started_at AT TIME ZONE 'UTC')::date AS ddate
        FROM public.tracker_page_sessions
        WHERE tenant_id IS NOT NULL
          AND (started_at AT TIME ZONE 'UTC')::date < (now() AT TIME ZONE 'UTC')::date
        ORDER BY ddate
    LOOP
        PERFORM public.upsert_tracker_summary_for_date(r.ddate);
        n_dates := n_dates + 1;
    END LOOP;
    RAISE NOTICE 'Backfilled % date(s) into tracker_session_daily_summary', n_dates;
END $$;


-- ─────────────────────────────────────────────────────────────────
-- VERIFICATION
--
--   -- See category breakdown for the last 7 days:
--   SELECT date, page_category, SUM(total_duration_seconds)/60 AS minutes
--   FROM tracker_session_daily_summary
--   GROUP BY date, page_category ORDER BY date DESC, minutes DESC LIMIT 30;
-- ─────────────────────────────────────────────────────────────────
