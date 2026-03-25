-- Migration to remove rogue AppInstall webhook events from the DB
DELETE FROM public.ghl_events WHERE event_type = 'AppInstall';
DELETE FROM public.ghl_event_daily_summary WHERE event_type = 'AppInstall';
