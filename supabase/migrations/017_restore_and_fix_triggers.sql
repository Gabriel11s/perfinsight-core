-- =================================================================
-- Multi-Tenant Replication Trigger Fix
--
-- Problem: Migration 016 accidentally dropped the `BEFORE INSERT`
-- auto-fill triggers. Since frontend tracker scripts submit rows 
-- with `tenant_id = null`, the `AFTER INSERT` replication trigger
-- fails because `(gcl.tenant_id != NEW.tenant_id)` returns NULL 
-- when `NEW.tenant_id` is null, causing zero rows to replicate.
--
-- Solution:
-- 1. Restore the `BEFORE INSERT` auto-fill triggers exactly as they were.
-- 2. Update the `AFTER INSERT` replication triggers to use `IS DISTINCT FROM`
--    so they logically duplicate records even if the initial assignment failed.
-- =================================================================

-- 1. RESTORE TRACKER SESSIONS BEFORE INSERT TRIGGER
CREATE OR REPLACE FUNCTION public.auto_fill_tenant_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Try to map location_id → tenant via the name cache
  IF NEW.tenant_id IS NULL AND NEW.location_id IS NOT NULL THEN
    SELECT tenant_id INTO NEW.tenant_id
    FROM public.ghl_cache_locations
    WHERE location_id = NEW.location_id
    LIMIT 1;
  END IF;

  -- Fallback: try ghl_oauth_tokens (location_id from OAuth grant)
  IF NEW.tenant_id IS NULL AND NEW.location_id IS NOT NULL THEN
    SELECT tenant_id INTO NEW.tenant_id
    FROM public.ghl_oauth_tokens
    WHERE location_id = NEW.location_id
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_tenant_id ON public.tracker_page_sessions;
CREATE TRIGGER trg_auto_tenant_id
  BEFORE INSERT ON public.tracker_page_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_fill_tenant_id();


-- 2. RESTORE GHL EVENTS BEFORE INSERT TRIGGER
CREATE OR REPLACE FUNCTION public.auto_fill_event_tenant_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Try to map location_id → tenant via the name cache
  IF NEW.tenant_id IS NULL AND NEW.location_id IS NOT NULL THEN
    SELECT tenant_id INTO NEW.tenant_id
    FROM public.ghl_cache_locations
    WHERE location_id = NEW.location_id
    LIMIT 1;
  END IF;

  -- Fallback: try ghl_oauth_tokens (location_id from OAuth grant)
  IF NEW.tenant_id IS NULL AND NEW.location_id IS NOT NULL THEN
    SELECT tenant_id INTO NEW.tenant_id
    FROM public.ghl_oauth_tokens
    WHERE location_id = NEW.location_id
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_event_tenant_id ON public.ghl_events;
CREATE TRIGGER trg_auto_event_tenant_id
  BEFORE INSERT ON public.ghl_events
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_fill_event_tenant_id();


-- 3. FIX AFTER INSERT REPLICATION FOR TRACKER SESSIONS (IS DISTINCT FROM)
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
    AND gcl.tenant_id IS DISTINCT FROM NEW.tenant_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4. FIX AFTER INSERT REPLICATION FOR GHL EVENTS (IS DISTINCT FROM)
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
    AND gcl.tenant_id IS DISTINCT FROM NEW.tenant_id
  ON CONFLICT (webhook_id, tenant_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
