-- =================================================================
-- Restore broken RPC functions
--
-- Problem: get_unique_ghl_ids and get_uncached_ghl_ids were modified
-- directly in the Supabase SQL Editor (not via migration), and the
-- modifications reference "column ge.user_counts" which does not
-- exist on ghl_events. Both functions now fail with error 42703.
--
-- Additionally, backfill_orphaned_sessions (from migration 015)
-- uses `is_bounce = true` which also does not exist as a column;
-- bounce counting must use duration_seconds < 10 instead.
--
-- This migration restores all three functions to correct definitions.
-- =================================================================

-- 1. Restore get_unique_ghl_ids
--    Returns ALL unique location_id and user_id values for a tenant
--    (used for full / force-refresh sync mode)
DROP FUNCTION IF EXISTS public.get_unique_ghl_ids(uuid);
CREATE OR REPLACE FUNCTION public.get_unique_ghl_ids(p_tenant_id uuid)
RETURNS TABLE (item_type text, id text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
    SELECT DISTINCT 'location'::text, location_id
    FROM public.tracker_page_sessions
    WHERE location_id IS NOT NULL AND location_id != ''
      AND (tenant_id = p_tenant_id OR tenant_id IS NULL);

  RETURN QUERY
    SELECT DISTINCT 'user'::text, user_id
    FROM public.tracker_page_sessions
    WHERE user_id IS NOT NULL AND user_id != ''
      AND (tenant_id = p_tenant_id OR tenant_id IS NULL);
END;
$$;


-- 2. Restore get_uncached_ghl_ids
--    Returns only location_id and user_id values NOT yet in the cache
--    for the given tenant (used for incremental sync mode).
--    Updated to join on (location_id, tenant_id) to correctly handle
--    the multi-tenant composite PK introduced in migration 016.
DROP FUNCTION IF EXISTS public.get_uncached_ghl_ids(uuid);
CREATE OR REPLACE FUNCTION public.get_uncached_ghl_ids(p_tenant_id uuid)
RETURNS TABLE (item_type text, id text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Uncached locations: in tracker sessions but not in THIS tenant's cache
  RETURN QUERY
    SELECT DISTINCT 'location'::text, tps.location_id
    FROM public.tracker_page_sessions tps
    LEFT JOIN public.ghl_cache_locations gcl
      ON tps.location_id = gcl.location_id
      AND gcl.tenant_id = p_tenant_id
    WHERE tps.location_id IS NOT NULL AND tps.location_id != ''
      AND (tps.tenant_id = p_tenant_id OR tps.tenant_id IS NULL)
      AND gcl.location_id IS NULL;

  -- Uncached users: in tracker sessions but not in THIS tenant's cache
  RETURN QUERY
    SELECT DISTINCT 'user'::text, tps.user_id
    FROM public.tracker_page_sessions tps
    LEFT JOIN public.ghl_cache_users gcu
      ON tps.user_id = gcu.user_id
      AND gcu.tenant_id = p_tenant_id
    WHERE tps.user_id IS NOT NULL AND tps.user_id != ''
      AND (tps.tenant_id = p_tenant_id OR tps.tenant_id IS NULL)
      AND gcu.user_id IS NULL;
END;
$$;


-- 3. Fix backfill_orphaned_sessions
--    Replace `is_bounce = true` with `duration_seconds < 10` since
--    tracker_page_sessions has no is_bounce column.
CREATE OR REPLACE FUNCTION public.backfill_orphaned_sessions(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  sessions_updated integer;
  events_updated   integer;
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
      SUM(sub.user_event_count)::integer                AS event_count,
      SUM(sub.sms_c)::integer                           AS sms_count,
      SUM(sub.call_c)::integer                          AS call_count,
      SUM(sub.email_c)::integer                         AS email_count,
      SUM(sub.other_c)::integer                         AS other_msg_count,
      jsonb_object_agg(sub.uid, sub.user_event_count)   AS user_counts
    FROM (
      SELECT
        tenant_id, location_id, event_type,
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
      WHERE tenant_id = p_tenant_id
      GROUP BY tenant_id, location_id, event_type,
               (event_date AT TIME ZONE 'UTC')::date,
               COALESCE(user_id, '_none')
    ) sub
    GROUP BY sub.tenant_id, sub.location_id, sub.event_date, sub.event_type;
  END IF;

  -- 4. Re-summarize Tracker Sessions if we claimed any new ones
  IF sessions_updated > 0 THEN
    DELETE FROM public.tracker_session_daily_summary WHERE tenant_id = p_tenant_id;

    INSERT INTO public.tracker_session_daily_summary
      (tenant_id, location_id, user_id, date,
       total_duration_seconds, session_count, bounce_count)
    SELECT
      tenant_id, location_id, user_id,
      (started_at AT TIME ZONE 'UTC')::date,
      SUM(duration_seconds)::integer,
      COUNT(*)::integer,
      COUNT(*) FILTER (WHERE COALESCE(duration_seconds, 0) < 10)::integer
    FROM public.tracker_page_sessions
    WHERE tenant_id = p_tenant_id
    GROUP BY tenant_id, location_id, user_id,
             (started_at AT TIME ZONE 'UTC')::date;
  END IF;

  RETURN sessions_updated + events_updated;
END;
$$;
