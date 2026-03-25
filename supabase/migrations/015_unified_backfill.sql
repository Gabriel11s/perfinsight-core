-- =================================================================
-- Unified Orphan Backfill 
--
-- Problem: Webhooks arrive with location_id before a new agency
-- account has been fully synced by `sync-ghl-names`, causing the
-- db trigger to fail mapping tenant_id. The events arrive orphaned.
-- Existing `backfill_orphaned_sessions` RPC only fixes tracker data.
--
-- Solution: Rewrite the RPC to claim orphaned `ghl_events` AND 
-- cleanly re-generate the daily rollups for the tenant so the 
-- dashboard displays the missed data instantly upon sync.
-- =================================================================

CREATE OR REPLACE FUNCTION public.backfill_orphaned_sessions(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  sessions_updated integer;
  events_updated integer;
BEGIN
  -- 1. Backfill Tracker Sessions
  UPDATE public.tracker_page_sessions tps
  SET tenant_id = gcl.tenant_id
  FROM public.ghl_cache_locations gcl
  WHERE tps.location_id = gcl.location_id
    AND gcl.tenant_id = p_tenant_id
    AND tps.tenant_id IS NULL;
  
  GET DIAGNOSTICS sessions_updated = ROW_COUNT;

  -- 2. Backfill GHL Events
  UPDATE public.ghl_events ge
  SET tenant_id = gcl.tenant_id
  FROM public.ghl_cache_locations gcl
  WHERE ge.location_id = gcl.location_id
    AND gcl.tenant_id = p_tenant_id
    AND ge.tenant_id IS NULL;
    
  GET DIAGNOSTICS events_updated = ROW_COUNT;

  -- 3. Re-summarize GHL Events if we found and claimed any new ones
  IF events_updated > 0 THEN
    DELETE FROM public.ghl_event_daily_summary WHERE tenant_id = p_tenant_id;
    
    INSERT INTO public.ghl_event_daily_summary
      (tenant_id, location_id, event_date, event_type, event_count,
       sms_count, call_count, email_count, other_msg_count, user_counts)
    SELECT
      sub.tenant_id,
      sub.location_id,
      sub.event_date,
      sub.event_type,
      SUM(sub.user_event_count)::integer AS event_count,
      SUM(sub.sms_c)::integer AS sms_count,
      SUM(sub.call_c)::integer AS call_count,
      SUM(sub.email_c)::integer AS email_count,
      SUM(sub.other_c)::integer AS other_msg_count,
      jsonb_object_agg(sub.uid, sub.user_event_count) AS user_counts
    FROM (
      SELECT
        tenant_id,
        location_id,
        event_type,
        (event_date AT TIME ZONE 'UTC')::date AS event_date,
        COALESCE(user_id, '_none') AS uid,
        COUNT(*) AS user_event_count,
        COUNT(*) FILTER (WHERE event_type IN ('InboundMessage','OutboundMessage')
          AND UPPER(COALESCE(event_data->>'messageType','')) = 'SMS') AS sms_c,
        COUNT(*) FILTER (WHERE event_type IN ('InboundMessage','OutboundMessage')
          AND UPPER(COALESCE(event_data->>'messageType','')) = 'CALL') AS call_c,
        COUNT(*) FILTER (WHERE event_type IN ('InboundMessage','OutboundMessage')
          AND UPPER(COALESCE(event_data->>'messageType','')) = 'EMAIL') AS email_c,
        COUNT(*) FILTER (WHERE event_type IN ('InboundMessage','OutboundMessage')
          AND UPPER(COALESCE(event_data->>'messageType','')) NOT IN ('SMS','CALL','EMAIL')) AS other_c
      FROM public.ghl_events
      WHERE tenant_id = p_tenant_id
      GROUP BY tenant_id, location_id, event_type,
               (event_date AT TIME ZONE 'UTC')::date, COALESCE(user_id, '_none')
    ) sub
    GROUP BY sub.tenant_id, sub.location_id, sub.event_date, sub.event_type;
  END IF;

  -- 4. Re-summarize Tracker Sessions if we claimed any new ones
  IF sessions_updated > 0 THEN
    DELETE FROM public.tracker_session_daily_summary WHERE tenant_id = p_tenant_id;
    
    INSERT INTO public.tracker_session_daily_summary
      (tenant_id, location_id, user_id, date, total_duration_seconds, session_count, bounce_count)
    SELECT
      tenant_id,
      location_id,
      user_id,
      (started_at AT TIME ZONE 'UTC')::date,
      SUM(duration_seconds)::integer,
      COUNT(*)::integer,
      COUNT(*) FILTER (WHERE is_bounce = true)::integer
    FROM public.tracker_page_sessions
    WHERE tenant_id = p_tenant_id
    GROUP BY tenant_id, location_id, user_id, (started_at AT TIME ZONE 'UTC')::date;
  END IF;

  RETURN sessions_updated + events_updated;
END;
$$;
