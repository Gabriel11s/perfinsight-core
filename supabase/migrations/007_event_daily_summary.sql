-- =================================================================
-- GHL Event Daily Summaries — aggregated event counts
-- Replaces raw ghl_events with compact daily rollups per location.
-- Run this in Supabase SQL Editor.
-- =================================================================

-- 1. Create the summary table
CREATE TABLE IF NOT EXISTS public.ghl_event_daily_summary (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id),
  location_id    text NOT NULL,
  event_date     date NOT NULL,
  event_type     text NOT NULL,
  event_count    integer NOT NULL DEFAULT 0,
  -- Message channel breakdown (InboundMessage / OutboundMessage only)
  sms_count      integer NOT NULL DEFAULT 0,
  call_count     integer NOT NULL DEFAULT 0,
  email_count    integer NOT NULL DEFAULT 0,
  other_msg_count integer NOT NULL DEFAULT 0,
  -- Per-user breakdown  { "userId1": 5, "userId2": 3 }
  user_counts    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

-- 2. Composite unique for upsert
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_summary_upsert
  ON public.ghl_event_daily_summary(tenant_id, location_id, event_date, event_type);

-- Query indexes
CREATE INDEX IF NOT EXISTS idx_daily_summary_tenant_date
  ON public.ghl_event_daily_summary(tenant_id, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_summary_location
  ON public.ghl_event_daily_summary(tenant_id, location_id, event_date DESC);


-- 3. RLS — same pattern as all other tables
ALTER TABLE public.ghl_event_daily_summary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_select_daily_summary" ON public.ghl_event_daily_summary;
CREATE POLICY "tenant_select_daily_summary" ON public.ghl_event_daily_summary
  FOR SELECT TO authenticated USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid()
    )
  );

-- Service role insert/update (webhook edge function uses service_role key)
DROP POLICY IF EXISTS "service_insert_daily_summary" ON public.ghl_event_daily_summary;
CREATE POLICY "service_insert_daily_summary" ON public.ghl_event_daily_summary
  FOR INSERT TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "service_update_daily_summary" ON public.ghl_event_daily_summary;
CREATE POLICY "service_update_daily_summary" ON public.ghl_event_daily_summary
  FOR UPDATE TO service_role
  USING (true);


-- 4. Backfill from existing ghl_events
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


-- 5. Create the upsert RPC for the webhook edge function
CREATE OR REPLACE FUNCTION public.upsert_event_summary(
  p_tenant_id    uuid,
  p_location_id  text,
  p_event_date   date,
  p_event_type   text,
  p_user_id      text,
  p_message_type text DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_uid text := COALESCE(p_user_id, '_none');
BEGIN
  INSERT INTO public.ghl_event_daily_summary
    (tenant_id, location_id, event_date, event_type, event_count,
     sms_count, call_count, email_count, other_msg_count, user_counts)
  VALUES (
    p_tenant_id,
    p_location_id,
    p_event_date,
    p_event_type,
    1,
    CASE WHEN UPPER(p_message_type) = 'SMS'   THEN 1 ELSE 0 END,
    CASE WHEN UPPER(p_message_type) = 'CALL'  THEN 1 ELSE 0 END,
    CASE WHEN UPPER(p_message_type) = 'EMAIL' THEN 1 ELSE 0 END,
    CASE WHEN p_event_type IN ('InboundMessage','OutboundMessage')
              AND UPPER(COALESCE(p_message_type,'')) NOT IN ('SMS','CALL','EMAIL')
         THEN 1 ELSE 0 END,
    jsonb_build_object(v_uid, 1)
  )
  ON CONFLICT (tenant_id, location_id, event_date, event_type)
  DO UPDATE SET
    event_count     = ghl_event_daily_summary.event_count + 1,
    sms_count       = ghl_event_daily_summary.sms_count
                      + CASE WHEN UPPER(p_message_type) = 'SMS' THEN 1 ELSE 0 END,
    call_count      = ghl_event_daily_summary.call_count
                      + CASE WHEN UPPER(p_message_type) = 'CALL' THEN 1 ELSE 0 END,
    email_count     = ghl_event_daily_summary.email_count
                      + CASE WHEN UPPER(p_message_type) = 'EMAIL' THEN 1 ELSE 0 END,
    other_msg_count = ghl_event_daily_summary.other_msg_count
                      + CASE WHEN p_event_type IN ('InboundMessage','OutboundMessage')
                                  AND UPPER(COALESCE(p_message_type,'')) NOT IN ('SMS','CALL','EMAIL')
                             THEN 1 ELSE 0 END,
    user_counts     = jsonb_set(
                        ghl_event_daily_summary.user_counts,
                        ARRAY[v_uid],
                        to_jsonb(
                          COALESCE((ghl_event_daily_summary.user_counts->>v_uid)::int, 0) + 1
                        )
                      ),
    updated_at      = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 6. Delete raw events older than 7 days (run manually or via pg_cron)
-- DELETE FROM public.ghl_events WHERE event_date < now() - interval '7 days';

-- To schedule automatic cleanup with pg_cron (if available):
-- SELECT cron.schedule(
--   'cleanup-old-ghl-events',
--   '0 3 * * *',                       -- every day at 3 AM UTC
--   $$DELETE FROM public.ghl_events WHERE event_date < now() - interval '7 days'$$
-- );
