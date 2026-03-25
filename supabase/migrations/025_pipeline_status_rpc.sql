-- =========================================================================================
-- MIGRATION: 025_pipeline_status_rpc.sql
-- PURPOSE: RPC to return pipeline health diagnostics for a tenant.
--          Used by the Settings > System Status section to surface data visibility issues.
--          SECURITY DEFINER so it can count orphaned rows (tenant_id IS NULL) that RLS hides.
-- =========================================================================================

CREATE OR REPLACE FUNCTION public.get_pipeline_status(p_tenant_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cached_locations   integer;
  v_cached_users       integer;
  v_orphaned_sessions  integer;
  v_orphaned_events    integer;
  v_sessions_24h       integer;
  v_events_24h         integer;
  v_active_users_24h   integer;
  v_active_locs_24h    integer;
  v_last_session_at    timestamptz;
  v_last_event_at      timestamptz;
  v_cutoff             timestamptz := now() - interval '24 hours';
BEGIN
  -- Cache counts
  SELECT COUNT(*) INTO v_cached_locations
  FROM public.ghl_cache_locations WHERE tenant_id = p_tenant_id;

  SELECT COUNT(*) INTO v_cached_users
  FROM public.ghl_cache_users WHERE tenant_id = p_tenant_id;

  -- Orphaned sessions: tenant_id IS NULL but location_id belongs to this tenant's cache
  SELECT COUNT(*) INTO v_orphaned_sessions
  FROM public.tracker_page_sessions tps
  WHERE tps.tenant_id IS NULL
    AND tps.location_id IN (
      SELECT location_id FROM public.ghl_cache_locations WHERE tenant_id = p_tenant_id
    );

  -- Orphaned events: same pattern
  SELECT COUNT(*) INTO v_orphaned_events
  FROM public.ghl_events ge
  WHERE ge.tenant_id IS NULL
    AND ge.location_id IN (
      SELECT location_id FROM public.ghl_cache_locations WHERE tenant_id = p_tenant_id
    );

  -- Last 24h activity for this tenant
  SELECT COUNT(*),
         COUNT(DISTINCT user_id),
         COUNT(DISTINCT location_id),
         MAX(started_at)
  INTO v_sessions_24h, v_active_users_24h, v_active_locs_24h, v_last_session_at
  FROM public.tracker_page_sessions
  WHERE tenant_id = p_tenant_id AND started_at >= v_cutoff;

  SELECT COUNT(*), MAX(event_date)
  INTO v_events_24h, v_last_event_at
  FROM public.ghl_events
  WHERE tenant_id = p_tenant_id AND event_date >= v_cutoff;

  RETURN json_build_object(
    'cached_locations',    v_cached_locations,
    'cached_users',        v_cached_users,
    'orphaned_sessions',   v_orphaned_sessions,
    'orphaned_events',     v_orphaned_events,
    'sessions_24h',        v_sessions_24h,
    'events_24h',          v_events_24h,
    'active_users_24h',    v_active_users_24h,
    'active_locations_24h', v_active_locs_24h,
    'last_session_at',     v_last_session_at,
    'last_event_at',       v_last_event_at
  );
END;
$$;
