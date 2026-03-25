-- =================================================================
-- Multi-Tenant Webhook Routing & Cache Data Duplication
--
-- Problem: Spark Tracker previously assumed a 1-to-1 mapping
-- between a GHL `location_id` and a Spark Tracker `tenant_id`.
-- When an Agency and a Sub-Account both install the app separately,
-- the location_id overlaps, causing one of them to lose analytics.
--
-- Solution:
-- 1. `ghl_cache_locations` drops the global uniqueness to become (tenant_id, location_id).
-- 2. `ghl_events` webhook index becomes (webhook_id, tenant_id).
-- 3. We introduce an AFTER INSERT trigger on tracker sessions and 
--    ghl events to recursively CLONE the incoming payload for ALL 
--    tenants tracking that location.
-- =================================================================

-- 1. Upgrade Location Caching (allow multiple tenants to cache same location)
ALTER TABLE public.ghl_cache_locations
  DROP CONSTRAINT IF EXISTS ghl_cache_locations_pkey CASCADE;

ALTER TABLE public.ghl_cache_locations
  ADD PRIMARY KEY (tenant_id, location_id);

-- 2. Upgrade Webhook Deduplication (allow duplicate webhooks if they go to different tenants)
DROP INDEX IF EXISTS public.idx_ghl_events_webhook_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ghl_events_webhook_tenant
  ON public.ghl_events(webhook_id, tenant_id)
  WHERE webhook_id IS NOT NULL AND tenant_id IS NOT NULL;

-- 3. Tracker Sessions Multi-Tenant Replication Trigger
CREATE OR REPLACE FUNCTION public.replicate_tracker_session_to_tenants()
RETURNS TRIGGER AS $$
BEGIN
  -- Prevent infinite loop when the replicated insert fires its own triggers
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- Replicate the session to all OTHER tenants tracking this location
  INSERT INTO public.tracker_page_sessions (
    tenant_id, location_id, session_id, user_id, contact_id, 
    started_at, ended_at, duration_seconds, is_bounce, 
    page_views, details, created_at
  )
  SELECT 
    DISTINCT gcl.tenant_id, NEW.location_id, NEW.session_id, NEW.user_id, NEW.contact_id, 
    NEW.started_at, NEW.ended_at, NEW.duration_seconds, NEW.is_bounce, 
    NEW.page_views, NEW.details, NEW.created_at
  FROM public.ghl_cache_locations gcl
  WHERE gcl.location_id = NEW.location_id
    AND gcl.tenant_id != NEW.tenant_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_replicate_tracker_session ON public.tracker_page_sessions;
CREATE TRIGGER trg_replicate_tracker_session
  AFTER INSERT ON public.tracker_page_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.replicate_tracker_session_to_tenants();

-- 4. GHL Events Multi-Tenant Replication Trigger
CREATE OR REPLACE FUNCTION public.replicate_ghl_event_to_tenants()
RETURNS TRIGGER AS $$
BEGIN
  -- Prevent infinite loop
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- Replicate the webhook event to all OTHER tenants tracking this location
  INSERT INTO public.ghl_events (
    tenant_id, location_id, event_type, user_id, contact_id, 
    event_data, event_date, webhook_id, created_at
  )
  SELECT 
    DISTINCT gcl.tenant_id, NEW.location_id, NEW.event_type, NEW.user_id, NEW.contact_id, 
    NEW.event_data, NEW.event_date, NEW.webhook_id, NEW.created_at
  FROM public.ghl_cache_locations gcl
  WHERE gcl.location_id = NEW.location_id
    AND gcl.tenant_id != NEW.tenant_id
  ON CONFLICT (webhook_id, tenant_id) DO NOTHING; -- Gracefully handle overlaps

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_replicate_ghl_event ON public.ghl_events;
CREATE TRIGGER trg_replicate_ghl_event
  AFTER INSERT ON public.ghl_events
  FOR EACH ROW
  EXECUTE FUNCTION public.replicate_ghl_event_to_tenants();
