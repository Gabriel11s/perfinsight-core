-- =================================================================
-- HOTFIX: Multi-tenant data isolation
-- Run this in Supabase SQL Editor to fix the data leak
-- =================================================================

-- 1. Fix the auto_fill_tenant_id trigger function
--    REMOVES the dangerous "assign to first tenant" fallback.
--    Now: ghl_cache_locations → ghl_oauth_tokens → leave NULL
CREATE OR REPLACE FUNCTION public.auto_fill_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  -- 1. Try to map location_id → tenant via the name cache
  IF NEW.tenant_id IS NULL AND NEW.location_id IS NOT NULL THEN
    SELECT tenant_id INTO NEW.tenant_id
    FROM public.ghl_cache_locations
    WHERE location_id = NEW.location_id
    LIMIT 1;
  END IF;
  -- 2. Fallback: try ghl_oauth_tokens (location_id from OAuth grant)
  IF NEW.tenant_id IS NULL AND NEW.location_id IS NOT NULL THEN
    SELECT tenant_id INTO NEW.tenant_id
    FROM public.ghl_oauth_tokens
    WHERE location_id = NEW.location_id
    LIMIT 1;
  END IF;
  -- 3. If still NULL → leave it NULL (orphaned session, invisible via RLS)
  --    It will be backfilled when the owning tenant syncs GHL names.
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Reset mis-assigned sessions: set tenant_id = NULL for sessions
--    whose location_id does NOT have a valid mapping in ghl_cache_locations
--    (This un-assigns data that was incorrectly assigned to the first tenant)
UPDATE public.tracker_page_sessions tps
SET tenant_id = NULL
WHERE tps.tenant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.ghl_cache_locations gcl
    WHERE gcl.location_id = tps.location_id
      AND gcl.tenant_id = tps.tenant_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.ghl_oauth_tokens got
    WHERE got.location_id = tps.location_id
      AND got.tenant_id = tps.tenant_id
  );

-- 3. Re-backfill using valid mappings
UPDATE public.tracker_page_sessions tps
SET tenant_id = gcl.tenant_id
FROM public.ghl_cache_locations gcl
WHERE tps.location_id = gcl.location_id
  AND tps.tenant_id IS NULL;

UPDATE public.tracker_page_sessions tps
SET tenant_id = got.tenant_id
FROM public.ghl_oauth_tokens got
WHERE tps.location_id = got.location_id
  AND tps.tenant_id IS NULL;

-- Done! Sessions without a valid location mapping are now NULL (invisible).
-- They will become visible when the owning tenant connects GHL and syncs.

-- 4. Create RPC function for backfilling orphaned sessions (called by sync-ghl-names)
CREATE OR REPLACE FUNCTION public.backfill_orphaned_sessions(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rows_updated integer;
BEGIN
  UPDATE public.tracker_page_sessions tps
  SET tenant_id = gcl.tenant_id
  FROM public.ghl_cache_locations gcl
  WHERE tps.location_id = gcl.location_id
    AND gcl.tenant_id = p_tenant_id
    AND tps.tenant_id IS NULL;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated;
END;
$$;
