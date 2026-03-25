-- =================================================================
-- REPAIR: Data Visibility and Historical Summaries
-- 1. Claims orphaned tracker_page_sessions (tenant_id IS NULL)
-- 2. Claims orphaned ghl_events (tenant_id IS NULL)
-- 3. Re-calculates ghl_event_daily_summary from the full dataset
-- =================================================================

-- 1. Claim orphaned tracker sessions from locations mapping
UPDATE public.tracker_page_sessions tps
SET tenant_id = gcl.tenant_id
FROM public.ghl_cache_locations gcl
WHERE tps.location_id = gcl.location_id
  AND tps.tenant_id IS NULL;

-- 2. Claim orphaned tracker sessions from oauth tokens mapping (fallback)
UPDATE public.tracker_page_sessions tps
SET tenant_id = got.tenant_id
FROM public.ghl_oauth_tokens got
WHERE tps.location_id = got.location_id
  AND tps.tenant_id IS NULL;

-- 3. Claim orphaned GHL events from locations mapping
UPDATE public.ghl_events ge
SET tenant_id = gcl.tenant_id
FROM public.ghl_cache_locations gcl
WHERE ge.location_id = gcl.location_id
  AND ge.tenant_id IS NULL;

-- 4. Claim orphaned GHL events from oauth tokens mapping (fallback)
UPDATE public.ghl_events ge
SET tenant_id = got.tenant_id
FROM public.ghl_oauth_tokens got
WHERE ge.location_id = got.location_id
  AND ge.tenant_id IS NULL;

-- 5. Clear and Re-calculate GHL Event Daily Summaries
--    This ensures all newly claimed events are included in the rollups
TRUNCATE TABLE public.ghl_event_daily_summary;

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
  WHERE tenant_id IS NOT NULL
  GROUP BY tenant_id, location_id, event_type,
           (event_date AT TIME ZONE 'UTC')::date, COALESCE(user_id, '_none')
) sub
GROUP BY sub.tenant_id, sub.location_id, sub.event_date, sub.event_type;

-- 6. Create a generalized repair RPC for the edge function to call
CREATE OR REPLACE FUNCTION public.repair_tenant_data(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Re-claim any orphaned rows for this tenant specifically
  UPDATE public.tracker_page_sessions tps
  SET tenant_id = p_tenant_id
  FROM public.ghl_cache_locations gcl
  WHERE tps.location_id = gcl.location_id
    AND gcl.tenant_id = p_tenant_id
    AND tps.tenant_id IS NULL;

  UPDATE public.ghl_events ge
  SET tenant_id = p_tenant_id
  FROM public.ghl_cache_locations gcl
  WHERE ge.location_id = gcl.location_id
    AND gcl.tenant_id = p_tenant_id
    AND ge.tenant_id IS NULL;
    
  -- Trigger a re-summarization (incremental logic is handled by upsert_event_summary, 
  -- but this repair ensures the base 'ghl_events' are cleaned up for RLS visibility)
END;
$$;
