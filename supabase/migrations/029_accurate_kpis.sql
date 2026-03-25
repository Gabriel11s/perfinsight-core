-- =================================================================
-- 029_accurate_kpis.sql
-- Fix data accuracy: server-side KPI + geo aggregation RPCs,
-- cron job repair, and summary backfill.
--
-- Problem: All dashboard KPIs were computed client-side from
-- paginated raw rows capped at 2,000 (useTrackerSessions) or
-- 3,000 (useGeoSessions). With 4,765+ daily sessions, numbers
-- were 30-80% wrong. The nightly_tracker_rollup cron was also
-- missing from cron.job.
--
-- Solution: Server-side aggregation RPCs that bypass PostgREST
-- pagination entirely. Fix the cron. Backfill missing summaries.
-- =================================================================


-- ─────────────────────────────────────────────────────────────────
-- SECTION 1: Real-time KPI aggregation for raw tracker sessions
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_tracker_kpis(
  p_start       timestamptz,
  p_end         timestamptz,
  p_user_id     text DEFAULT NULL,
  p_location_id text DEFAULT NULL
)
RETURNS TABLE (
  total_sessions    bigint,
  total_seconds     bigint,
  unique_users      bigint,
  unique_locations  bigint,
  bounce_count      bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  -- Resolve caller's tenant (same pattern as upsert_user_presence)
  SELECT tm.tenant_id INTO v_tenant_id
  FROM public.tenant_members tm
  WHERE tm.user_id = auth.uid()
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RETURN QUERY SELECT 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::bigint                                                AS total_sessions,
    COALESCE(SUM(COALESCE(tps.duration_seconds, 0)), 0)::bigint    AS total_seconds,
    COUNT(DISTINCT tps.user_id)::bigint                             AS unique_users,
    COUNT(DISTINCT tps.location_id)::bigint                         AS unique_locations,
    COUNT(*) FILTER (WHERE COALESCE(tps.duration_seconds, 0) < 10)::bigint AS bounce_count
  FROM public.tracker_page_sessions tps
  WHERE tps.tenant_id = v_tenant_id
    AND tps.started_at >= p_start
    AND tps.started_at <= p_end
    AND (p_user_id IS NULL OR tps.user_id = p_user_id)
    AND (p_location_id IS NULL OR tps.location_id = p_location_id);
END;
$$;

COMMENT ON FUNCTION public.get_tracker_kpis IS
  'Returns accurate KPI aggregates for tracker sessions within a date range. '
  'Bypasses PostgREST pagination. Resolves tenant via auth.uid(). '
  'Optional user_id/location_id filters for detail pages.';


-- ─────────────────────────────────────────────────────────────────
-- SECTION 2: Historical KPI aggregation from summary table
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_tracker_kpis_summary(
  p_start_date  date,
  p_end_date    date,
  p_user_id     text DEFAULT NULL,
  p_location_id text DEFAULT NULL
)
RETURNS TABLE (
  total_sessions    bigint,
  total_seconds     bigint,
  unique_users      bigint,
  unique_locations  bigint,
  bounce_count      bigint
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
    RETURN QUERY SELECT 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM(s.session_count), 0)::bigint            AS total_sessions,
    COALESCE(SUM(s.total_duration_seconds), 0)::bigint    AS total_seconds,
    COUNT(DISTINCT s.user_id)::bigint                     AS unique_users,
    COUNT(DISTINCT s.location_id)::bigint                 AS unique_locations,
    COALESCE(SUM(s.bounce_count), 0)::bigint              AS bounce_count
  FROM public.tracker_session_daily_summary s
  WHERE s.tenant_id = v_tenant_id
    AND s.date >= p_start_date
    AND s.date <= p_end_date
    AND (p_user_id IS NULL OR s.user_id = p_user_id)
    AND (p_location_id IS NULL OR s.location_id = p_location_id);
END;
$$;

COMMENT ON FUNCTION public.get_tracker_kpis_summary IS
  'Returns accurate KPI aggregates from the daily summary table for historical ranges. '
  'Companion to get_tracker_kpis (which queries raw sessions for today).';


-- ─────────────────────────────────────────────────────────────────
-- SECTION 3: Server-side geo aggregation by city
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_geo_session_aggregates(
  p_start timestamptz,
  p_end   timestamptz
)
RETURNS TABLE (
  geo_city         text,
  geo_region       text,
  geo_country      text,
  geo_lat          double precision,
  geo_lon          double precision,
  session_count    bigint,
  total_seconds    bigint,
  unique_users     bigint
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
    COALESCE(tps.geo_city, 'Unknown')                              AS geo_city,
    COALESCE(tps.geo_region, '')                                   AS geo_region,
    tps.geo_country                                                AS geo_country,
    (ARRAY_AGG(tps.geo_lat ORDER BY tps.started_at DESC))[1]      AS geo_lat,
    (ARRAY_AGG(tps.geo_lon ORDER BY tps.started_at DESC))[1]      AS geo_lon,
    COUNT(*)::bigint                                               AS session_count,
    COALESCE(SUM(COALESCE(tps.duration_seconds, 0)), 0)::bigint   AS total_seconds,
    COUNT(DISTINCT tps.user_id)::bigint                            AS unique_users
  FROM public.tracker_page_sessions tps
  WHERE tps.tenant_id = v_tenant_id
    AND tps.started_at >= p_start
    AND tps.started_at <= p_end
    AND tps.geo_country IS NOT NULL
  GROUP BY
    COALESCE(tps.geo_city, 'Unknown'),
    COALESCE(tps.geo_region, ''),
    tps.geo_country
  ORDER BY session_count DESC;
END;
$$;

COMMENT ON FUNCTION public.get_geo_session_aggregates IS
  'Server-side geo aggregation by city. Replaces client-side 3,000-row paginated '
  'fetch + JS aggregation. Returns one row per city with accurate totals.';


-- ─────────────────────────────────────────────────────────────────
-- SECTION 4: Per-user latest geo info
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_user_geo_latest(
  p_start timestamptz,
  p_end   timestamptz
)
RETURNS TABLE (
  user_id      text,
  geo_lat      double precision,
  geo_lon      double precision,
  geo_city     text,
  geo_region   text,
  geo_country  text
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
  SELECT DISTINCT ON (tps.user_id)
    tps.user_id,
    tps.geo_lat,
    tps.geo_lon,
    COALESCE(tps.geo_city, 'Unknown'),
    COALESCE(tps.geo_region, ''),
    tps.geo_country
  FROM public.tracker_page_sessions tps
  WHERE tps.tenant_id = v_tenant_id
    AND tps.started_at >= p_start
    AND tps.started_at <= p_end
    AND tps.geo_country IS NOT NULL
  ORDER BY tps.user_id, tps.started_at DESC;
END;
$$;

COMMENT ON FUNCTION public.get_user_geo_latest IS
  'Returns the most recent geo info per user (DISTINCT ON user_id, ORDER BY started_at DESC). '
  'Used by UserCard components for displaying user locations.';


-- ─────────────────────────────────────────────────────────────────
-- SECTION 5: Fix missing cron jobs
-- ─────────────────────────────────────────────────────────────────

DO $$
BEGIN
    -- Remove existing jobs if they exist (idempotent)
    BEGIN
        PERFORM cron.unschedule('nightly_tracker_rollup');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
        PERFORM cron.unschedule('tracker_rollup_catchup');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Schedule nightly rollup: 1:00 AM UTC, rolls up yesterday
    PERFORM cron.schedule(
        'nightly_tracker_rollup',
        '0 1 * * *',
        'SELECT public.upsert_tracker_summary_for_date((now() - interval ''1 day'')::date);'
    );

    -- Safety net: 1:30 AM UTC, rolls up day-before-yesterday (catches missed days)
    PERFORM cron.schedule(
        'tracker_rollup_catchup',
        '30 1 * * *',
        'SELECT public.upsert_tracker_summary_for_date((now() - interval ''2 days'')::date);'
    );

    RAISE NOTICE 'Registered nightly_tracker_rollup and tracker_rollup_catchup cron jobs';
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Failed to setup pg_cron jobs: %', SQLERRM;
END $$;


-- ─────────────────────────────────────────────────────────────────
-- SECTION 6: Backfill missing summary dates
-- ─────────────────────────────────────────────────────────────────

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
          AND (started_at AT TIME ZONE 'UTC')::date NOT IN (
              SELECT DISTINCT date FROM public.tracker_session_daily_summary
          )
        ORDER BY ddate
    LOOP
        PERFORM public.upsert_tracker_summary_for_date(r.ddate);
        n_dates := n_dates + 1;
    END LOOP;

    -- Also re-run yesterday to capture any late-arriving data
    PERFORM public.upsert_tracker_summary_for_date(((now() - interval '1 day') AT TIME ZONE 'UTC')::date);
    n_dates := n_dates + 1;

    RAISE NOTICE 'Backfilled % date(s) into tracker_session_daily_summary', n_dates;
END $$;
