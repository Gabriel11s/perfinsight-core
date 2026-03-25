-- Enable pg_cron if it's not already enabled (this may fail if not superuser, but usually works on Supabase)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule automatic cleanup with pg_cron
SELECT cron.schedule(
  'cleanup-old-ghl-events',
  '0 3 * * *',                       -- every day at 3 AM UTC
  $$DELETE FROM public.ghl_events WHERE event_date < now() - interval '7 days'$$
);
