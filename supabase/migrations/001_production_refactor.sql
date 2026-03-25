-- =================================================================
-- SPARK TRACKER — Production Migration
-- Run this ENTIRE script in your Supabase SQL Editor
-- =================================================================

-- ┌────────────────────────────────────────────────────────────────┐
-- │ PHASE 1: Schema Changes                                       │
-- └────────────────────────────────────────────────────────────────┘

-- 1.1  Add tenant_id to tracker_page_sessions
--      (the GHL tracker script doesn't send this — a trigger fills it)
ALTER TABLE public.tracker_page_sessions
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);

-- 1.2  Drop the unused duplicate table
DROP TABLE IF EXISTS public.tracker_sessions;


-- ┌────────────────────────────────────────────────────────────────┐
-- │ PHASE 2: Backfill tenant_id for existing rows                 │
-- └────────────────────────────────────────────────────────────────┘

-- 2.1  Fill from ghl_cache_locations (location → tenant mapping)
UPDATE public.tracker_page_sessions tps
SET tenant_id = gcl.tenant_id
FROM public.ghl_cache_locations gcl
WHERE tps.location_id = gcl.location_id
  AND tps.tenant_id IS NULL;

-- 2.2  Second pass: try ghl_oauth_tokens (location_id from OAuth grant)
UPDATE public.tracker_page_sessions tps
SET tenant_id = got.tenant_id
FROM public.ghl_oauth_tokens got
WHERE tps.location_id = got.location_id
  AND tps.tenant_id IS NULL;

-- 2.3  Any remaining NULLs stay NULL (orphaned sessions).
--      They become visible when the owning tenant connects GHL and syncs names.


-- ┌────────────────────────────────────────────────────────────────┐
-- │ PHASE 3: Auto-fill trigger (for new rows from tracker script) │
-- └────────────────────────────────────────────────────────────────┘

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

DROP TRIGGER IF EXISTS trg_auto_tenant_id ON public.tracker_page_sessions;
CREATE TRIGGER trg_auto_tenant_id
  BEFORE INSERT ON public.tracker_page_sessions
  FOR EACH ROW EXECUTE FUNCTION public.auto_fill_tenant_id();


-- ┌────────────────────────────────────────────────────────────────┐
-- │ PHASE 4: Indexes for performance                              │
-- └────────────────────────────────────────────────────────────────┘

CREATE INDEX IF NOT EXISTS idx_tps_tenant_started
  ON public.tracker_page_sessions(tenant_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_tps_user_id
  ON public.tracker_page_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_tps_location_id
  ON public.tracker_page_sessions(location_id);

CREATE INDEX IF NOT EXISTS idx_tps_tenant_user
  ON public.tracker_page_sessions(tenant_id, user_id);

CREATE INDEX IF NOT EXISTS idx_tps_tenant_location
  ON public.tracker_page_sessions(tenant_id, location_id);

CREATE INDEX IF NOT EXISTS idx_tenant_members_user
  ON public.tenant_members(user_id);


-- ┌────────────────────────────────────────────────────────────────┐
-- │ PHASE 5: Row Level Security                                   │
-- └────────────────────────────────────────────────────────────────┘

-- 5.1  tracker_page_sessions
ALTER TABLE public.tracker_page_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_insert_sessions" ON public.tracker_page_sessions;
CREATE POLICY "anon_insert_sessions" ON public.tracker_page_sessions
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "tenant_select_sessions" ON public.tracker_page_sessions;
CREATE POLICY "tenant_select_sessions" ON public.tracker_page_sessions
  FOR SELECT TO authenticated USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid()
    )
  );

-- 5.2  tenants
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_select_own" ON public.tenants;
CREATE POLICY "tenant_select_own" ON public.tenants
  FOR SELECT TO authenticated USING (
    id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid()
    )
  );

-- 5.3  tenant_members
ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members_select_own" ON public.tenant_members;
CREATE POLICY "members_select_own" ON public.tenant_members
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 5.4  ghl_cache_users
ALTER TABLE public.ghl_cache_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cache_users_select" ON public.ghl_cache_users;
CREATE POLICY "cache_users_select" ON public.ghl_cache_users
  FOR SELECT TO authenticated USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid()
    )
  );

-- 5.5  ghl_cache_locations
ALTER TABLE public.ghl_cache_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cache_locations_select" ON public.ghl_cache_locations;
CREATE POLICY "cache_locations_select" ON public.ghl_cache_locations
  FOR SELECT TO authenticated USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid()
    )
  );

-- 5.6  ghl_oauth_tokens
ALTER TABLE public.ghl_oauth_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tokens_select_own" ON public.ghl_oauth_tokens;
CREATE POLICY "tokens_select_own" ON public.ghl_oauth_tokens
  FOR SELECT TO authenticated USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tokens_delete_own" ON public.ghl_oauth_tokens;
CREATE POLICY "tokens_delete_own" ON public.ghl_oauth_tokens
  FOR DELETE TO authenticated USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid()
    )
  );

-- 5.7  settings
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settings_select_own" ON public.settings;
CREATE POLICY "settings_select_own" ON public.settings
  FOR SELECT TO authenticated USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "settings_insert_own" ON public.settings;
CREATE POLICY "settings_insert_own" ON public.settings
  FOR INSERT TO authenticated WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "settings_update_own" ON public.settings;
CREATE POLICY "settings_update_own" ON public.settings
  FOR UPDATE TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid()
    )
  );

-- 5.8  alerts
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "alerts_select_own" ON public.alerts;
CREATE POLICY "alerts_select_own" ON public.alerts
  FOR SELECT TO authenticated USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid()
    )
  );


-- ┌────────────────────────────────────────────────────────────────┐
-- │ PHASE 6: RPC Functions                                        │
-- └────────────────────────────────────────────────────────────────┘

-- 6.1  get_unique_ghl_ids — ALL unique IDs for a tenant (full sync)
DROP FUNCTION IF EXISTS get_unique_ghl_ids();
DROP FUNCTION IF EXISTS get_unique_ghl_ids(uuid);

CREATE OR REPLACE FUNCTION get_unique_ghl_ids(p_tenant_id uuid)
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

-- 6.2  get_uncached_ghl_ids — only IDs NOT in cache (incremental sync)
CREATE OR REPLACE FUNCTION get_uncached_ghl_ids(p_tenant_id uuid)
RETURNS TABLE (item_type text, id text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Uncached locations
  RETURN QUERY
    SELECT DISTINCT 'location'::text, tps.location_id
    FROM public.tracker_page_sessions tps
    LEFT JOIN public.ghl_cache_locations gcl
      ON tps.location_id = gcl.location_id
    WHERE tps.location_id IS NOT NULL AND tps.location_id != ''
      AND (tps.tenant_id = p_tenant_id OR tps.tenant_id IS NULL)
      AND gcl.location_id IS NULL;

  -- Uncached users
  RETURN QUERY
    SELECT DISTINCT 'user'::text, tps.user_id
    FROM public.tracker_page_sessions tps
    LEFT JOIN public.ghl_cache_users gcu
      ON tps.user_id = gcu.user_id
    WHERE tps.user_id IS NOT NULL AND tps.user_id != ''
      AND (tps.tenant_id = p_tenant_id OR tps.tenant_id IS NULL)
      AND gcu.user_id IS NULL;
END;
$$;


-- ┌────────────────────────────────────────────────────────────────┐
-- │ PHASE 7: Ensure settings row exists for current tenant        │
-- └────────────────────────────────────────────────────────────────┘

INSERT INTO public.settings (tenant_id, timezone, working_hours, thresholds)
SELECT
  t.id,
  'America/Sao_Paulo',
  '{"start":"09:00","end":"18:00","days":[1,2,3,4,5]}'::jsonb,
  '{"no_activity_days":7,"min_minutes_week":30,"usage_drop_pct":50,"bounce_threshold_seconds":10,"tracker_offline_minutes":60}'::jsonb
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.settings s WHERE s.tenant_id = t.id
);


-- ┌────────────────────────────────────────────────────────────────┐
-- │ DONE — Verify with:                                           │
-- │   SELECT count(*) FROM tracker_page_sessions WHERE            │
-- │     tenant_id IS NULL;  -- should be 0                        │
-- └────────────────────────────────────────────────────────────────┘
