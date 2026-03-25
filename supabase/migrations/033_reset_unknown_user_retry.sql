-- Migration 033: Reset Unknown User retry timestamps
--
-- Marks all existing "Unknown User" cache entries with an old updated_at so
-- the new 7-day retry logic in sync-names-scheduled (and sync-ghl-names) treats
-- them as stale and retries the GHL API lookup on the very first sync run.
--
-- Context: Previously, "Unknown User" entries were never retried once written.
-- The new system retries them after STALE_UNKNOWN_RETRY_DAYS (7 days) using
-- updated_at as the retry timer. This migration bootstraps the retry by making
-- all existing entries appear stale immediately.

UPDATE public.ghl_cache_users
SET updated_at = '2020-01-01 00:00:00+00'
WHERE user_name = 'Unknown User';
