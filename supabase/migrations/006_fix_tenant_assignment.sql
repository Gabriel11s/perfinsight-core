-- =================================================================
-- Fix Tenant Assignment — move GHL data to the correct tenant
-- 
-- Problem:  All 231 GHL locations, events, and cached users are
--           assigned to tenant d3272033-d7fd-4735-afb1-fe1cb7f15f47
--           but the user (info@sparkleads.pro) is a member of tenant
--           a730f1a2-b163-4485-8fd6-84c214ff1f02.
--
-- Solution: Reassign all GHL data to the user's current tenant.
--
-- Run this in Supabase SQL Editor.
-- =================================================================

DO $$
DECLARE
  old_tenant uuid := 'd3272033-d7fd-4735-afb1-fe1cb7f15f47';
  new_tenant uuid := 'a730f1a2-b163-4485-8fd6-84c214ff1f02';
  rows_updated bigint;
BEGIN
  -- 1. Reassign cached locations
  UPDATE public.ghl_cache_locations
  SET tenant_id = new_tenant
  WHERE tenant_id = old_tenant;
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE '✅ ghl_cache_locations reassigned: % rows', rows_updated;

  -- 2. Reassign cached users
  UPDATE public.ghl_cache_users
  SET tenant_id = new_tenant
  WHERE tenant_id = old_tenant;
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE '✅ ghl_cache_users reassigned: % rows', rows_updated;

  -- 3. Reassign GHL events
  UPDATE public.ghl_events
  SET tenant_id = new_tenant
  WHERE tenant_id = old_tenant;
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE '✅ ghl_events reassigned: % rows', rows_updated;

  -- 4. Reassign tracker sessions
  UPDATE public.tracker_page_sessions
  SET tenant_id = new_tenant
  WHERE tenant_id = old_tenant;
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE '✅ tracker_page_sessions reassigned: % rows', rows_updated;

  -- 5. Move the OAuth token (delete old tenant token, keep only the one for new tenant)
  --    If there's already a token for new_tenant, just delete the old one
  DELETE FROM public.ghl_oauth_tokens
  WHERE tenant_id = old_tenant;
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE '✅ ghl_oauth_tokens cleaned: % rows deleted for old tenant', rows_updated;

  -- 6. Move settings if they exist on old tenant
  UPDATE public.settings
  SET tenant_id = new_tenant
  WHERE tenant_id = old_tenant
    AND NOT EXISTS (SELECT 1 FROM public.settings WHERE tenant_id = new_tenant);
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE '✅ settings reassigned: % rows', rows_updated;

  -- 7. Move alerts
  UPDATE public.alerts
  SET tenant_id = new_tenant
  WHERE tenant_id = old_tenant;
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE '✅ alerts reassigned: % rows', rows_updated;

  -- 8. Optionally delete the orphaned tenant (only if no members remain)
  DELETE FROM public.tenants
  WHERE id = old_tenant
    AND NOT EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = old_tenant);
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE '✅ orphaned tenant deleted: % rows', rows_updated;

  RAISE NOTICE '🎉 Migration complete! All data now belongs to tenant %', new_tenant;
END $$;
