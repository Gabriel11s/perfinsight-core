-- =================================================================
-- Add company_id column to ghl_oauth_tokens
-- Also drop the old permissive RLS policy that caused data leaks
-- Run this in Supabase SQL Editor
-- =================================================================

-- 1. Add company_id column (nullable, for backward compatibility)
ALTER TABLE public.ghl_oauth_tokens
ADD COLUMN IF NOT EXISTS company_id text;

-- 2. Drop the old permissive SELECT policy that bypasses tenant isolation
DROP POLICY IF EXISTS "authenticated_select_tracker_page_sessions" ON public.tracker_page_sessions;

-- 3. Drop the duplicate anon insert policy
DROP POLICY IF EXISTS "anon_insert_tracker_page_sessions" ON public.tracker_page_sessions;
