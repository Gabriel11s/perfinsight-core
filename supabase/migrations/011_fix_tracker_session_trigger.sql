-- =================================================================
-- Fix Tracker Session Auto-fill Trigger
--
-- The previous trigger `auto_fill_tenant_id` was written with standard
-- LANGUAGE plpgsql but was executing on INSERTS done by 'anon'.
-- Because `ghl_cache_locations` and `ghl_oauth_tokens` have strict RLS,
-- the trigger could not read those tables, resulting in newly created 
-- tracker sessions receiving `tenant_id = null`.
-- 
-- The fix applies SECURITY DEFINER so the trigger executes with Postgres 
-- super-user permissions, allowing it to bypass RLS to lookup locations.
-- =================================================================

CREATE OR REPLACE FUNCTION public.auto_fill_tenant_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
  RETURN NEW;
END;
$$;

-- =================================================================
-- Retoactively update orphaned sessions that were captured with `null` tenant_id
-- =================================================================

UPDATE public.tracker_page_sessions tps
SET tenant_id = gcl.tenant_id
FROM public.ghl_cache_locations gcl
WHERE tps.location_id = gcl.location_id
  AND tps.tenant_id IS NULL;
