-- =========================================================================================
-- MIGRATION: 024_cleanup_old_tracker_sessions.sql
-- PURPOSE: Add pg_cron job to delete raw tracker_page_sessions older than 7 days.
--          Same pattern as ghl_events cleanup (migration 008).
--
-- SAFETY: The nightly summary job ('nightly_tracker_rollup') runs at 1 AM UTC and
--         summarizes the previous day into tracker_session_daily_summary. This cleanup
--         runs at 2 AM UTC — one hour after the summary — so data is always summarized
--         before the raw rows are deleted. Data older than 7 days was summarized at
--         least 6 days ago.
-- =========================================================================================

SELECT cron.schedule(
  'cleanup-old-tracker-sessions',
  '0 2 * * *',                       -- every day at 2 AM UTC (1 hour after summary)
  $$DELETE FROM public.tracker_page_sessions WHERE started_at < now() - interval '7 days'$$
);
