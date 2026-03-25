-- =================================================================
-- Clear Empty GHL Names Cache
-- Deletes any rows in ghl_cache_users where the user_name equals
-- the user_id, forcing the edge function to re-fetch their real names
-- =================================================================

DELETE FROM public.ghl_cache_users
WHERE user_name = user_id;
