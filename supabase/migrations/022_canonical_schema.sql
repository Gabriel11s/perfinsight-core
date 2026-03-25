-- =================================================================
-- 022_canonical_schema.sql
-- Canonical Schema Alignment & Replication Fix
--
-- Context:
--   The live database diverged from the migration history because
--   several changes were made directly in the Supabase SQL Editor
--   rather than through migrations. This migration is the authoritative
--   source of truth that aligns the schema with:
--     1. What the GHL tracker script actually sends
--     2. Correct multi-tenant primary keys
--     3. Correct replication trigger column names
--
-- This migration is fully idempotent:
--   - Uses IF EXISTS / IF NOT EXISTS / CREATE OR REPLACE
--   - Safe to re-run if something is already in the correct state
-- =================================================================


-- ─────────────────────────────────────────────────────────────────
-- SECTION 1: Align tracker_page_sessions schema
--
-- The GHL tracker script (docs/ghl-tracker-script.js) sends:
--   user_id, location_id, page_path, started_at, ended_at,
--   duration_seconds, heartbeats, details
--
-- Migrations 016 and 017 erroneously referenced columns that were
-- removed from the live table (session_id, contact_id, is_bounce,
-- page_views). Confirmed missing: migration 019 failed with
-- "column is_bounce does not exist".
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE public.tracker_page_sessions
  DROP COLUMN IF EXISTS session_id,
  DROP COLUMN IF EXISTS contact_id,
  DROP COLUMN IF EXISTS is_bounce,
  DROP COLUMN IF EXISTS page_views;

-- heartbeats and page_path are sent by the tracker script
ALTER TABLE public.tracker_page_sessions
  ADD COLUMN IF NOT EXISTS heartbeats integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS page_path  text;

-- Index on page_path for per-page analytics queries
CREATE INDEX IF NOT EXISTS idx_tps_page_path
  ON public.tracker_page_sessions (tenant_id, page_path);

COMMENT ON TABLE public.tracker_page_sessions IS
  'One row per GHL page visit. Inserted by the tracker script via REST API '
  'with anon key. BEFORE INSERT trigger fills tenant_id from ghl_cache_locations. '
  'AFTER INSERT trigger replicates to other tenants sharing the same location_id.';

COMMENT ON COLUMN public.tracker_page_sessions.heartbeats IS
  'Count of 15-second heartbeat ticks received while the page was visible. '
  'Each tick = user was actively on the page. duration_seconds is computed at session end.';


-- ─────────────────────────────────────────────────────────────────
-- SECTION 2: Fix ghl_cache_users to be truly multi-tenant
--
-- Original PK was single-column (user_id). This is incorrect for a
-- multi-tenant system: if tenant A and tenant B both track user X,
-- only one tenant's row can exist.
--
-- New PK: (tenant_id, user_id) — each tenant maintains its own
-- user name cache independently.
-- ─────────────────────────────────────────────────────────────────

-- Remove any orphaned rows before adding NOT NULL PK constraint
DELETE FROM public.ghl_cache_users WHERE tenant_id IS NULL;

ALTER TABLE public.ghl_cache_users
  DROP CONSTRAINT IF EXISTS ghl_cache_users_pkey;

ALTER TABLE public.ghl_cache_users
  ADD PRIMARY KEY (tenant_id, user_id);

COMMENT ON TABLE public.ghl_cache_users IS
  'Cache of GHL user display names, keyed per tenant. '
  'PK is (tenant_id, user_id) so each tenant independently caches users. '
  'Populated by the sync-ghl-names edge function.';


-- ─────────────────────────────────────────────────────────────────
-- SECTION 3: Fix replicate_tracker_session_to_tenants()
--
-- Migrations 016 and 017 created this function referencing columns
-- that no longer exist (session_id, contact_id, is_bounce, page_views).
-- When the AFTER INSERT trigger fires, PostgreSQL throws an error and
-- rolls back the entire transaction — meaning NO tracker sessions are
-- saved to the database.
--
-- This is THE root cause of tracker_page_sessions data loss.
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.replicate_tracker_session_to_tenants()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Guard: prevent infinite loop when the replicated INSERT fires its own trigger
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- Replicate this session to every OTHER tenant that tracks the same location.
  -- This supports the agency + direct-business model where multiple tenants
  -- may legitimately track the same GHL location_id.
  INSERT INTO public.tracker_page_sessions (
    tenant_id,
    location_id,
    user_id,
    page_path,
    started_at,
    ended_at,
    duration_seconds,
    heartbeats,
    details,
    created_at
  )
  SELECT
    gcl.tenant_id,
    NEW.location_id,
    NEW.user_id,
    NEW.page_path,
    NEW.started_at,
    NEW.ended_at,
    NEW.duration_seconds,
    NEW.heartbeats,
    NEW.details,
    NEW.created_at
  FROM public.ghl_cache_locations gcl
  WHERE gcl.location_id = NEW.location_id
    AND gcl.tenant_id IS DISTINCT FROM NEW.tenant_id;

  RETURN NEW;
END;
$$;

-- Re-attach the trigger (idempotent: drops first if it exists)
DROP TRIGGER IF EXISTS trg_replicate_tracker_session ON public.tracker_page_sessions;
CREATE TRIGGER trg_replicate_tracker_session
  AFTER INSERT ON public.tracker_page_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.replicate_tracker_session_to_tenants();

COMMENT ON FUNCTION public.replicate_tracker_session_to_tenants() IS
  'AFTER INSERT trigger on tracker_page_sessions. '
  'Copies the new row to every other tenant that shares the same location_id '
  'via ghl_cache_locations. Uses pg_trigger_depth() guard to prevent recursion. '
  'Uses IS DISTINCT FROM for NULL-safe tenant comparison.';


-- ─────────────────────────────────────────────────────────────────
-- SECTION 4: Fix get_uncached_ghl_ids RPC
--
-- Now that ghl_cache_users has a composite PK (tenant_id, user_id),
-- the LEFT JOIN must include tenant_id — otherwise every user appears
-- uncached for every tenant (the join never matches).
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_uncached_ghl_ids(p_tenant_id uuid)
RETURNS TABLE (item_type text, id text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Locations present in tracker sessions but not in cache for this tenant
  RETURN QUERY
    SELECT DISTINCT 'location'::text, tps.location_id
    FROM public.tracker_page_sessions tps
    LEFT JOIN public.ghl_cache_locations gcl
      ON  gcl.location_id = tps.location_id
      AND gcl.tenant_id   = p_tenant_id
    WHERE tps.location_id IS NOT NULL
      AND tps.location_id != ''
      AND (tps.tenant_id = p_tenant_id OR tps.tenant_id IS NULL)
      AND gcl.location_id IS NULL;

  -- Users present in tracker sessions but not in cache for this tenant
  RETURN QUERY
    SELECT DISTINCT 'user'::text, tps.user_id
    FROM public.tracker_page_sessions tps
    LEFT JOIN public.ghl_cache_users gcu
      ON  gcu.user_id   = tps.user_id
      AND gcu.tenant_id = p_tenant_id
    WHERE tps.user_id IS NOT NULL
      AND tps.user_id != ''
      AND (tps.tenant_id = p_tenant_id OR tps.tenant_id IS NULL)
      AND gcu.user_id IS NULL;
END;
$$;

COMMENT ON FUNCTION public.get_uncached_ghl_ids(uuid) IS
  'Returns location_ids and user_ids from tracker_page_sessions that are '
  'not yet present in the name cache for the given tenant. '
  'Used by sync-ghl-names for incremental (non-force-refresh) syncs.';


-- ─────────────────────────────────────────────────────────────────
-- VERIFICATION
-- Run these after applying to confirm correctness:
--
--   -- Correct columns on tracker_page_sessions:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'tracker_page_sessions' ORDER BY ordinal_position;
--
--   -- Composite PK on ghl_cache_users:
--   SELECT constraint_name FROM information_schema.table_constraints
--   WHERE table_name = 'ghl_cache_users' AND constraint_type = 'PRIMARY KEY';
--
--   -- Trigger attached and enabled:
--   SELECT tgname, tgenabled FROM pg_trigger
--   WHERE tgrelid = 'tracker_page_sessions'::regclass;
-- ─────────────────────────────────────────────────────────────────
