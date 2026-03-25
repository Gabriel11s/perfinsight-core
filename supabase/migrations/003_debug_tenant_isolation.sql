-- =================================================================
-- DIAGNOSTIC: Run this in Supabase SQL Editor to check tenant state
-- Copy each query separately and run them one by one
-- =================================================================

-- 1. How many tenants exist?
SELECT id, name, mode, owner_user_id, created_at
FROM public.tenants
ORDER BY created_at;

-- 2. How many tenant_members exist? (each user → tenant mapping)
SELECT tm.id, tm.tenant_id, tm.user_id, tm.role, tm.created_at,
       t.name as tenant_name,
       au.email as user_email
FROM public.tenant_members tm
JOIN public.tenants t ON t.id = tm.tenant_id
JOIN auth.users au ON au.id = tm.user_id
ORDER BY tm.created_at;

-- 3. Check RLS is enabled on tracker_page_sessions
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('tracker_page_sessions', 'tenants', 'tenant_members',
                     'ghl_cache_users', 'ghl_cache_locations', 'ghl_oauth_tokens', 'settings');

-- 4. Check what policies exist on tracker_page_sessions
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'tracker_page_sessions';

-- 5. How many sessions per tenant_id? (NULL = orphaned)
SELECT tenant_id, count(*) as session_count
FROM public.tracker_page_sessions
GROUP BY tenant_id
ORDER BY session_count DESC;

-- 6. Check if the trigger exists
SELECT trigger_name, event_manipulation, action_statement
FROM information_schema.triggers
WHERE event_object_table = 'tracker_page_sessions';
