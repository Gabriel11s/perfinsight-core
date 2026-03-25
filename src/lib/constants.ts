/**
 * Centralized configuration constants.
 * Uses VITE_ env vars when available, with hardcoded fallbacks for dev.
 */

export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://xrcurxegylqjrbmfihte.supabase.co';

export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyY3VyeGVneWxxanJibWZpaHRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzOTI1NzgsImV4cCI6MjA4OTk2ODU3OH0.P47Jj6Q-7HPmafQ-aI0K-1mYUcqFS7LnxLAOqQLLYAI';

export const GHL_CLIENT_ID =
  import.meta.env.VITE_GHL_CLIENT_ID ?? '69b8b5d41be630d182694cf0-mn68l48c';

export const GHL_MARKETPLACE_URL =
  'https://marketplace.leadconnectorhq.com/oauth/chooselocation';
export const GHL_SCOPES =
  'locations.readonly users.readonly calendars/events.readonly calendars.readonly conversations.readonly conversations/message.readonly contacts.readonly locations/tasks.readonly locations/tags.readonly opportunities.readonly';

export const TRACKER_TABLE = 'tracker_page_sessions' as const;
export const BOUNCE_THRESHOLD_SECONDS = 10;
