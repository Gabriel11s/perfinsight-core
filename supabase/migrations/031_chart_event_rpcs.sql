-- =================================================================
-- 031_chart_event_rpcs.sql
-- Per-date and per-hour event count RPCs for the Activity Over Time chart.
-- Ensures chart event totals exactly match the GHL Events KPI number
-- by using the same source table, date format, and filtering logic.
-- =================================================================

-- =================================================================
-- get_daily_event_counts: Per-date event counts from ghl_event_daily_summary
-- Uses the SAME table, date format, and filtering as get_event_summary_totals
-- so that sum(daily_counts) === KPI total (guaranteed).
-- =================================================================

CREATE OR REPLACE FUNCTION public.get_daily_event_counts(
  p_start_date      text,
  p_end_date        text,
  p_user_id         text DEFAULT NULL,
  p_location_id     text DEFAULT NULL,
  p_excluded_types  text[] DEFAULT ARRAY[]::text[]
)
RETURNS TABLE (
  event_date  date,
  event_count bigint
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
    e.event_date,
    CASE
      WHEN p_user_id IS NOT NULL THEN
        COALESCE(SUM((e.user_counts ->> p_user_id)::integer), 0)::bigint
      ELSE
        COALESCE(SUM(e.event_count), 0)::bigint
    END AS event_count
  FROM public.ghl_event_daily_summary e
  WHERE e.tenant_id = v_tenant_id
    AND e.event_date >= p_start_date::date
    AND e.event_date <= p_end_date::date
    AND (p_location_id IS NULL OR e.location_id = p_location_id)
    AND (p_user_id IS NULL OR (e.user_counts ->> p_user_id)::integer > 0)
    -- Exclude INSTALL noise (same as useEnabledGhlEvents client-side filter)
    AND e.event_type NOT ILIKE '%install%'
    -- Exclude user-disabled event types
    AND (array_length(p_excluded_types, 1) IS NULL OR e.event_type != ALL(p_excluded_types))
  GROUP BY e.event_date
  ORDER BY e.event_date;
END;
$$;

COMMENT ON FUNCTION public.get_daily_event_counts IS
  'Returns per-date event counts from ghl_event_daily_summary. '
  'Uses identical table, date format, and user filtering as get_event_summary_totals '
  'so that sum(daily_counts) === KPI total. Excludes INSTALL + user-disabled types.';


-- =================================================================
-- get_hourly_event_counts: Per-hour event counts from raw ghl_events
-- For "today" hourly view — summary table only has date granularity.
-- Aggregates in Postgres so no 2000-row PostgREST cap.
-- Uses text date params + event_date::date filtering to match the SAME
-- date boundary as get_event_summary_totals (KPI) and get_daily_event_counts.
-- =================================================================

CREATE OR REPLACE FUNCTION public.get_hourly_event_counts(
  p_start_date      text,
  p_end_date        text,
  p_user_id         text DEFAULT NULL,
  p_location_id     text DEFAULT NULL,
  p_excluded_types  text[] DEFAULT ARRAY[]::text[]
)
RETURNS TABLE (
  hour_bucket timestamptz,
  event_count bigint
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
    date_trunc('hour', e.event_date) AS hour_bucket,
    COUNT(*)::bigint AS event_count
  FROM public.ghl_events e
  WHERE e.tenant_id = v_tenant_id
    AND e.event_date::date >= p_start_date::date
    AND e.event_date::date <= p_end_date::date
    AND (p_user_id IS NULL OR e.user_id = p_user_id)
    AND (p_location_id IS NULL OR e.location_id = p_location_id)
    -- Exclude INSTALL noise
    AND e.event_type NOT ILIKE '%install%'
    -- Exclude user-disabled event types
    AND (array_length(p_excluded_types, 1) IS NULL OR e.event_type != ALL(p_excluded_types))
  GROUP BY date_trunc('hour', e.event_date)
  ORDER BY hour_bucket;
END;
$$;

COMMENT ON FUNCTION public.get_hourly_event_counts IS
  'Returns per-hour event counts from raw ghl_events. Uses event_date::date filtering '
  'to match the same date boundary as get_event_summary_totals and get_daily_event_counts '
  '(all use UTC date comparison). Aggregates in Postgres — no PostgREST 2000-row cap.';
