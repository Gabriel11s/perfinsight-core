-- =================================================================
-- Backfill NULL tenant_id rows and regenerate summaries
--
-- Context: While sync-ghl-names was broken (onConflict mismatch after
-- migration 016 changed ghl_cache_locations PK to composite), none of
-- the location cache writes succeeded. As a result, the BEFORE INSERT
-- triggers on ghl_events and tracker_page_sessions could not resolve
-- tenant_id, leaving rows with tenant_id = NULL (invisible via RLS).
--
-- Run this migration AFTER:
--   1. Deploying the fixed sync-ghl-names Edge Function
--   2. Triggering a Force Refresh Sync from the Settings page
--      (to repopulate ghl_cache_locations with correct data)
--
-- Steps:
--   1. Claim orphaned ghl_events via cache, then oauth fallback
--   2. Claim orphaned tracker_page_sessions via cache, then oauth fallback
--   3. Rebuild ghl_event_daily_summary for every affected tenant
--   4. Rebuild tracker_session_daily_summary for every affected tenant
-- =================================================================

DO $$
DECLARE
  v_tenant        record;
  v_events_cache  integer := 0;
  v_events_oauth  integer := 0;
  v_sess_cache    integer := 0;
  v_sess_oauth    integer := 0;
BEGIN

  -- ── Step 1: Backfill NULL tenant_id in ghl_events ──

  UPDATE public.ghl_events ge
  SET tenant_id = gcl.tenant_id
  FROM public.ghl_cache_locations gcl
  WHERE ge.location_id = gcl.location_id
    AND ge.tenant_id IS NULL;

  GET DIAGNOSTICS v_events_cache = ROW_COUNT;
  RAISE NOTICE 'Step 1a: Claimed % orphaned ghl_events via ghl_cache_locations', v_events_cache;

  UPDATE public.ghl_events ge
  SET tenant_id = got.tenant_id
  FROM public.ghl_oauth_tokens got
  WHERE ge.location_id = got.location_id
    AND ge.tenant_id IS NULL;

  GET DIAGNOSTICS v_events_oauth = ROW_COUNT;
  RAISE NOTICE 'Step 1b: Claimed % additional orphaned ghl_events via ghl_oauth_tokens', v_events_oauth;


  -- ── Step 2: Backfill NULL tenant_id in tracker_page_sessions ──

  UPDATE public.tracker_page_sessions tps
  SET tenant_id = gcl.tenant_id
  FROM public.ghl_cache_locations gcl
  WHERE tps.location_id = gcl.location_id
    AND tps.tenant_id IS NULL;

  GET DIAGNOSTICS v_sess_cache = ROW_COUNT;
  RAISE NOTICE 'Step 2a: Claimed % orphaned tracker_page_sessions via ghl_cache_locations', v_sess_cache;

  UPDATE public.tracker_page_sessions tps
  SET tenant_id = got.tenant_id
  FROM public.ghl_oauth_tokens got
  WHERE tps.location_id = got.location_id
    AND tps.tenant_id IS NULL;

  GET DIAGNOSTICS v_sess_oauth = ROW_COUNT;
  RAISE NOTICE 'Step 2b: Claimed % additional orphaned tracker_page_sessions via ghl_oauth_tokens', v_sess_oauth;


  -- ── Step 3: Rebuild ghl_event_daily_summary for every tenant ──

  FOR v_tenant IN
    SELECT DISTINCT tenant_id FROM public.ghl_events WHERE tenant_id IS NOT NULL
  LOOP
    DELETE FROM public.ghl_event_daily_summary
    WHERE tenant_id = v_tenant.tenant_id;

    INSERT INTO public.ghl_event_daily_summary
      (tenant_id, location_id, event_date, event_type, event_count,
       sms_count, call_count, email_count, other_msg_count, user_counts)
    SELECT
      sub.tenant_id,
      sub.location_id,
      sub.event_date,
      sub.event_type,
      SUM(sub.user_event_count)::integer                AS event_count,
      SUM(sub.sms_c)::integer                           AS sms_count,
      SUM(sub.call_c)::integer                          AS call_count,
      SUM(sub.email_c)::integer                         AS email_count,
      SUM(sub.other_c)::integer                         AS other_msg_count,
      jsonb_object_agg(sub.uid, sub.user_event_count)   AS user_counts
    FROM (
      SELECT
        tenant_id,
        location_id,
        event_type,
        (event_date AT TIME ZONE 'UTC')::date AS event_date,
        COALESCE(user_id, '_none')            AS uid,
        COUNT(*)                              AS user_event_count,
        COUNT(*) FILTER (
          WHERE event_type IN ('InboundMessage','OutboundMessage')
            AND UPPER(COALESCE(event_data->>'messageType','')) = 'SMS'
        )   AS sms_c,
        COUNT(*) FILTER (
          WHERE event_type IN ('InboundMessage','OutboundMessage')
            AND UPPER(COALESCE(event_data->>'messageType','')) = 'CALL'
        )  AS call_c,
        COUNT(*) FILTER (
          WHERE event_type IN ('InboundMessage','OutboundMessage')
            AND UPPER(COALESCE(event_data->>'messageType','')) = 'EMAIL'
        ) AS email_c,
        COUNT(*) FILTER (
          WHERE event_type IN ('InboundMessage','OutboundMessage')
            AND UPPER(COALESCE(event_data->>'messageType','')) NOT IN ('SMS','CALL','EMAIL')
        ) AS other_c
      FROM public.ghl_events
      WHERE tenant_id = v_tenant.tenant_id
      GROUP BY
        tenant_id, location_id, event_type,
        (event_date AT TIME ZONE 'UTC')::date,
        COALESCE(user_id, '_none')
    ) sub
    GROUP BY sub.tenant_id, sub.location_id, sub.event_date, sub.event_type
    ON CONFLICT (tenant_id, location_id, event_date, event_type)
    DO UPDATE SET
      event_count     = EXCLUDED.event_count,
      sms_count       = EXCLUDED.sms_count,
      call_count      = EXCLUDED.call_count,
      email_count     = EXCLUDED.email_count,
      other_msg_count = EXCLUDED.other_msg_count,
      user_counts     = EXCLUDED.user_counts,
      updated_at      = now();

    RAISE NOTICE 'Step 3: Rebuilt ghl_event_daily_summary for tenant %', v_tenant.tenant_id;
  END LOOP;


  -- ── Step 4: Rebuild tracker_session_daily_summary for every tenant ──

  FOR v_tenant IN
    SELECT DISTINCT tenant_id FROM public.tracker_page_sessions WHERE tenant_id IS NOT NULL
  LOOP
    DELETE FROM public.tracker_session_daily_summary
    WHERE tenant_id = v_tenant.tenant_id;

    INSERT INTO public.tracker_session_daily_summary
      (tenant_id, location_id, user_id, date,
       total_duration_seconds, session_count, bounce_count)
    SELECT
      tenant_id,
      location_id,
      user_id,
      (started_at AT TIME ZONE 'UTC')::date AS date,
      SUM(duration_seconds)::integer,
      COUNT(*)::integer,
      COUNT(*) FILTER (WHERE COALESCE(duration_seconds, 0) < 10)::integer
    FROM public.tracker_page_sessions
    WHERE tenant_id = v_tenant.tenant_id
    GROUP BY
      tenant_id, location_id, user_id,
      (started_at AT TIME ZONE 'UTC')::date
    ON CONFLICT (tenant_id, location_id, user_id, date)
    DO UPDATE SET
      total_duration_seconds = EXCLUDED.total_duration_seconds,
      session_count          = EXCLUDED.session_count,
      bounce_count           = EXCLUDED.bounce_count,
      updated_at             = now();

    RAISE NOTICE 'Step 4: Rebuilt tracker_session_daily_summary for tenant %', v_tenant.tenant_id;
  END LOOP;

  RAISE NOTICE 'Migration 019 complete. ghl_events claimed: %, tracker_page_sessions claimed: %',
    (v_events_cache + v_events_oauth), (v_sess_cache + v_sess_oauth);

END $$;
