-- =================================================================
-- 030_scalable_queries.sql
-- Server-side RPCs to eliminate PostgREST silent row caps.
--
-- Problem: Four frontend queries hit the PostgREST max_rows=1000
-- default, silently dropping data:
--   1. tracker_session_daily_summary (no pagination) — 7-day chart broken
--   2. ghl_event_daily_summary (.limit(2000) ignored) — events underreported
--   3. ghl_cache_locations (no pagination) — labels lost at 1000+ locations
--   4. ghl_cache_users (no pagination) — labels lost at 1000+ users
--
-- Solution: Server-side RPCs that aggregate in Postgres and return
-- compact results with no pagination cap.
-- =================================================================


-- ─────────────────────────────────────────────────────────────────
-- SECTION 1: Daily activity chart data (sessions + events combined)
-- Returns one row per date with aggregated minutes and event counts.
-- Used by the "Activity Over Time" chart on 7-day/30-day views.
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_daily_activity_chart(
  p_start           timestamptz,
  p_end             timestamptz,
  p_user_id         text DEFAULT NULL,
  p_location_id     text DEFAULT NULL,
  p_excluded_types  text[] DEFAULT ARRAY[]::text[]
)
RETURNS TABLE (
  date              date,
  total_minutes     bigint,
  total_sessions    bigint,
  total_events      bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tm.tenant_id INTO v_tenant_id
  FROM public.tenant_members tm
  WHERE tm.user_id = auth.uid()
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH session_daily AS (
    SELECT
      s.date AS d,
      COALESCE(SUM(s.session_count), 0)::bigint AS sessions,
      COALESCE(SUM(s.total_duration_seconds), 0)::bigint AS seconds
    FROM public.tracker_session_daily_summary s
    WHERE s.tenant_id = v_tenant_id
      AND s.date >= (p_start AT TIME ZONE 'UTC')::date
      AND s.date <= (p_end AT TIME ZONE 'UTC')::date
      AND (p_user_id IS NULL OR s.user_id = p_user_id)
      AND (p_location_id IS NULL OR s.location_id = p_location_id)
    GROUP BY s.date
  ),
  event_daily AS (
    SELECT
      e.event_date::date AS d,
      CASE
        WHEN p_user_id IS NOT NULL THEN
          COALESCE(SUM(
            (e.user_counts ->> p_user_id)::integer
          ), 0)::bigint
        ELSE
          COALESCE(SUM(e.event_count), 0)::bigint
      END AS events
    FROM public.ghl_event_daily_summary e
    WHERE e.tenant_id = v_tenant_id
      AND e.event_date >= (p_start AT TIME ZONE 'UTC')::date
      AND e.event_date <= (p_end AT TIME ZONE 'UTC')::date
      AND (p_location_id IS NULL OR e.location_id = p_location_id)
      -- Exclude INSTALL noise
      AND e.event_type NOT ILIKE '%install%'
      -- Exclude user-disabled event types (passed from frontend settings)
      AND (array_length(p_excluded_types, 1) IS NULL OR e.event_type != ALL(p_excluded_types))
    GROUP BY e.event_date::date
  )
  SELECT
    COALESCE(sd.d, ed.d)                        AS date,
    COALESCE(sd.seconds / 60, 0)::bigint        AS total_minutes,
    COALESCE(sd.sessions, 0)::bigint            AS total_sessions,
    COALESCE(ed.events, 0)::bigint              AS total_events
  FROM session_daily sd
  FULL OUTER JOIN event_daily ed ON sd.d = ed.d
  ORDER BY date;
END;
$$;

COMMENT ON FUNCTION public.get_daily_activity_chart IS
  'Returns one row per date with aggregated session minutes and event counts. '
  'Used by the Activity Over Time chart on 7-day/30-day views. '
  'Bypasses PostgREST pagination entirely. Respects enabled_events filtering '
  'client-side (INSTALL events excluded server-side).';


-- ─────────────────────────────────────────────────────────────────
-- SECTION 2: Event summary totals by event_type
-- Returns one row per event_type with aggregated counts.
-- Used by EventSummaryCards, pie chart, and GHL Events KPI.
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_event_summary_totals(
  p_start_date    text,
  p_end_date      text,
  p_user_id       text DEFAULT NULL,
  p_location_id   text DEFAULT NULL
)
RETURNS TABLE (
  event_type      text,
  event_count     bigint,
  sms_count       bigint,
  call_count      bigint,
  email_count     bigint,
  other_msg_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tm.tenant_id INTO v_tenant_id
  FROM public.tenant_members tm
  WHERE tm.user_id = auth.uid()
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    e.event_type,
    CASE
      WHEN p_user_id IS NOT NULL THEN
        COALESCE(SUM((e.user_counts ->> p_user_id)::integer), 0)::bigint
      ELSE
        COALESCE(SUM(e.event_count), 0)::bigint
    END AS event_count,
    COALESCE(SUM(e.sms_count), 0)::bigint     AS sms_count,
    COALESCE(SUM(e.call_count), 0)::bigint     AS call_count,
    COALESCE(SUM(e.email_count), 0)::bigint    AS email_count,
    COALESCE(SUM(e.other_msg_count), 0)::bigint AS other_msg_count
  FROM public.ghl_event_daily_summary e
  WHERE e.tenant_id = v_tenant_id
    AND e.event_date >= p_start_date::date
    AND e.event_date <= p_end_date::date
    AND (p_location_id IS NULL OR e.location_id = p_location_id)
    -- When filtering by user, only include rows where user has counts
    AND (p_user_id IS NULL OR (e.user_counts ->> p_user_id)::integer > 0)
  GROUP BY e.event_type
  ORDER BY event_count DESC;
END;
$$;

COMMENT ON FUNCTION public.get_event_summary_totals IS
  'Returns aggregated event counts by event_type across a date range. '
  'Handles user_counts JSONB filtering server-side. '
  'Bypasses PostgREST pagination. Used by EventSummaryCards and pie chart.';


-- ─────────────────────────────────────────────────────────────────
-- SECTION 3: Cache name lookup (locations + users)
-- Returns all cache entries for the caller's tenant, no cap.
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_cache_names()
RETURNS TABLE (
  type           text,
  id             text,
  name           text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tm.tenant_id INTO v_tenant_id
  FROM public.tenant_members tm
  WHERE tm.user_id = auth.uid()
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    'location'::text AS type,
    cl.location_id   AS id,
    cl.location_name AS name
  FROM public.ghl_cache_locations cl
  WHERE cl.tenant_id = v_tenant_id

  UNION ALL

  SELECT
    'user'::text     AS type,
    cu.user_id       AS id,
    cu.user_name     AS name
  FROM public.ghl_cache_users cu
  WHERE cu.tenant_id = v_tenant_id;
END;
$$;

COMMENT ON FUNCTION public.get_cache_names IS
  'Returns all cached location and user names for the caller''s tenant. '
  'Bypasses PostgREST max_rows cap. Returns type=location or type=user.';
