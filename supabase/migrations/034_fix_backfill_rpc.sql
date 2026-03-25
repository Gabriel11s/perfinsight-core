-- =========================================================================================
-- MIGRATION: 034_fix_backfill_rpc.sql
-- PURPOSE:   Fix three bugs in backfill_orphaned_sessions():
--
--   Bug 1 (is_bounce): The original function (migration 015) referenced `is_bounce = true`
--   in the tracker session summary rebuild. That column was dropped in migration 022.
--   Fix: use COALESCE(duration_seconds, 0) < 10 (the actual bounce definition).
--
--   Bug 2 (page_category): Migration 023 added page_category to tracker_session_daily_summary
--   and updated the UNIQUE constraint to include it. The backfill rebuilt summaries without
--   page_category, producing incorrect single-category rows. Fix: group by categorize_page_path().
--
--   Bug 3 (full rebuild perf): The original function deleted ALL summary rows for the tenant
--   and rebuilt from ALL raw data — catastrophically slow for tenants with 400K+ events,
--   causing statement timeouts for just 7 orphaned rows. Fix: capture affected (location, date)
--   combos BEFORE the UPDATE and only rebuild those specific summary rows (targeted rebuild).
-- =========================================================================================

CREATE OR REPLACE FUNCTION public.backfill_orphaned_sessions(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  sessions_updated integer;
  events_updated   integer;
BEGIN

  -- ── Capture affected event location/dates BEFORE claiming ─────────────────
  CREATE TEMP TABLE IF NOT EXISTS _backfill_event_dates AS
    SELECT DISTINCT ge.location_id,
                    (ge.event_date AT TIME ZONE 'UTC')::date AS event_date_utc
    FROM public.ghl_events ge
    JOIN public.ghl_cache_locations gcl
      ON gcl.location_id = ge.location_id AND gcl.tenant_id = p_tenant_id
    WHERE ge.tenant_id IS NULL;

  -- ── Capture affected session location/dates BEFORE claiming ───────────────
  CREATE TEMP TABLE IF NOT EXISTS _backfill_session_dates AS
    SELECT DISTINCT tps.location_id,
                    tps.user_id,
                    (tps.started_at AT TIME ZONE 'UTC')::date AS session_date_utc
    FROM public.tracker_page_sessions tps
    JOIN public.ghl_cache_locations gcl
      ON gcl.location_id = tps.location_id AND gcl.tenant_id = p_tenant_id
    WHERE tps.tenant_id IS NULL;

  -- 1. Claim orphaned tracker sessions
  UPDATE public.tracker_page_sessions tps
  SET tenant_id = gcl.tenant_id
  FROM public.ghl_cache_locations gcl
  WHERE tps.location_id = gcl.location_id
    AND gcl.tenant_id = p_tenant_id
    AND tps.tenant_id IS NULL;
  GET DIAGNOSTICS sessions_updated = ROW_COUNT;

  -- 2. Claim orphaned GHL events
  UPDATE public.ghl_events ge
  SET tenant_id = gcl.tenant_id
  FROM public.ghl_cache_locations gcl
  WHERE ge.location_id = gcl.location_id
    AND gcl.tenant_id = p_tenant_id
    AND ge.tenant_id IS NULL;
  GET DIAGNOSTICS events_updated = ROW_COUNT;

  -- 3. Targeted event summary rebuild — only affected (location, date) combos
  IF events_updated > 0 THEN
    DELETE FROM public.ghl_event_daily_summary eds
    WHERE eds.tenant_id = p_tenant_id
      AND EXISTS (
        SELECT 1 FROM _backfill_event_dates bd
        WHERE bd.location_id = eds.location_id
          AND bd.event_date_utc = eds.event_date
      );

    INSERT INTO public.ghl_event_daily_summary
      (tenant_id, location_id, event_date, event_type, event_count,
       sms_count, call_count, email_count, other_msg_count, user_counts)
    SELECT
      sub.tenant_id,
      sub.location_id,
      sub.event_date,
      sub.event_type,
      SUM(sub.user_event_count)::integer,
      SUM(sub.sms_c)::integer,
      SUM(sub.call_c)::integer,
      SUM(sub.email_c)::integer,
      SUM(sub.other_c)::integer,
      jsonb_object_agg(sub.uid, sub.user_event_count)
    FROM (
      SELECT
        ge.tenant_id,
        ge.location_id,
        ge.event_type,
        (ge.event_date AT TIME ZONE 'UTC')::date AS event_date,
        COALESCE(ge.user_id, '_none') AS uid,
        COUNT(*) AS user_event_count,
        COUNT(*) FILTER (WHERE ge.event_type IN ('InboundMessage','OutboundMessage')
          AND UPPER(COALESCE(ge.event_data->>'messageType','')) = 'SMS') AS sms_c,
        COUNT(*) FILTER (WHERE ge.event_type IN ('InboundMessage','OutboundMessage')
          AND UPPER(COALESCE(ge.event_data->>'messageType','')) = 'CALL') AS call_c,
        COUNT(*) FILTER (WHERE ge.event_type IN ('InboundMessage','OutboundMessage')
          AND UPPER(COALESCE(ge.event_data->>'messageType','')) = 'EMAIL') AS email_c,
        COUNT(*) FILTER (WHERE ge.event_type IN ('InboundMessage','OutboundMessage')
          AND UPPER(COALESCE(ge.event_data->>'messageType','')) NOT IN ('SMS','CALL','EMAIL')) AS other_c
      FROM public.ghl_events ge
      WHERE ge.tenant_id = p_tenant_id
        AND EXISTS (
          SELECT 1 FROM _backfill_event_dates bd
          WHERE bd.location_id = ge.location_id
            AND bd.event_date_utc = (ge.event_date AT TIME ZONE 'UTC')::date
        )
      GROUP BY ge.tenant_id, ge.location_id, ge.event_type,
               (ge.event_date AT TIME ZONE 'UTC')::date, COALESCE(ge.user_id, '_none')
    ) sub
    GROUP BY sub.tenant_id, sub.location_id, sub.event_date, sub.event_type;
  END IF;

  -- 4. Targeted session summary rebuild — only affected (location, user, date) combos
  --    Groups by page_category to match UNIQUE(tenant_id,location_id,user_id,date,page_category)
  --    Uses COALESCE(duration_seconds,0) < 10 for bounce detection (is_bounce column was dropped)
  IF sessions_updated > 0 THEN
    DELETE FROM public.tracker_session_daily_summary tsd
    WHERE tsd.tenant_id = p_tenant_id
      AND EXISTS (
        SELECT 1 FROM _backfill_session_dates bsd
        WHERE bsd.location_id    = tsd.location_id
          AND bsd.user_id        = tsd.user_id
          AND bsd.session_date_utc = tsd.date
      );

    INSERT INTO public.tracker_session_daily_summary
      (tenant_id, location_id, user_id, date, page_category,
       total_duration_seconds, session_count, bounce_count)
    SELECT
      tps.tenant_id,
      tps.location_id,
      tps.user_id,
      (tps.started_at AT TIME ZONE 'UTC')::date                                AS date,
      public.categorize_page_path(COALESCE(tps.page_path, ''))                 AS page_category,
      SUM(COALESCE(tps.duration_seconds, 0))::integer                          AS total_duration_seconds,
      COUNT(*)::integer                                                         AS session_count,
      COUNT(*) FILTER (WHERE COALESCE(tps.duration_seconds, 0) < 10)::integer  AS bounce_count
    FROM public.tracker_page_sessions tps
    WHERE tps.tenant_id = p_tenant_id
      AND tps.user_id IS NOT NULL
      AND tps.location_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM _backfill_session_dates bsd
        WHERE bsd.location_id    = tps.location_id
          AND bsd.user_id        = tps.user_id
          AND bsd.session_date_utc = (tps.started_at AT TIME ZONE 'UTC')::date
      )
    GROUP BY
      tps.tenant_id, tps.location_id, tps.user_id,
      (tps.started_at AT TIME ZONE 'UTC')::date,
      public.categorize_page_path(COALESCE(tps.page_path, ''));
  END IF;

  -- Cleanup temp tables
  DROP TABLE IF EXISTS _backfill_event_dates;
  DROP TABLE IF EXISTS _backfill_session_dates;

  RETURN sessions_updated + events_updated;
END;
$$;
