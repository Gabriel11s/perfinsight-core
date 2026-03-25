-- =========================================================================================
-- MIGRATION: 026_geo_client_metadata.sql
-- PURPOSE: Add geolocation and client metadata columns to tracker_page_sessions.
--          Geo data is populated by the tracker-ingest edge function using IP lookup.
--          Client metadata (timezone, locale, screen, user_agent) is sent by the tracker script.
-- =========================================================================================

-- Geo columns (populated server-side from IP)
ALTER TABLE public.tracker_page_sessions
  ADD COLUMN IF NOT EXISTS geo_country      text,
  ADD COLUMN IF NOT EXISTS geo_region       text,
  ADD COLUMN IF NOT EXISTS geo_city         text,
  ADD COLUMN IF NOT EXISTS geo_lat          double precision,
  ADD COLUMN IF NOT EXISTS geo_lon          double precision,
  ADD COLUMN IF NOT EXISTS geo_timezone     text;

-- Client metadata (sent by tracker script)
ALTER TABLE public.tracker_page_sessions
  ADD COLUMN IF NOT EXISTS client_timezone  text,
  ADD COLUMN IF NOT EXISTS client_locale    text,
  ADD COLUMN IF NOT EXISTS user_agent       text,
  ADD COLUMN IF NOT EXISTS screen_width     integer,
  ADD COLUMN IF NOT EXISTS screen_height    integer;

-- Index for geo queries (country + region for aggregation)
CREATE INDEX IF NOT EXISTS idx_tracker_sessions_geo
  ON public.tracker_page_sessions (tenant_id, geo_country, geo_region)
  WHERE geo_country IS NOT NULL;
