-- =================================================================
-- Dashboard Tracker — Base Schema
-- Creates all tables that exist before the migration system was added.
-- =================================================================

-- ─── tenants ───
CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  mode text DEFAULT 'agency',
  owner_user_id uuid,
  created_at timestamptz DEFAULT now()
);

-- ─── tenant_members ───
CREATE TABLE IF NOT EXISTS public.tenant_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id),
  user_id uuid,
  role text DEFAULT 'owner',
  created_at timestamptz DEFAULT now()
);

-- ─── tracker_page_sessions ───
CREATE TABLE IF NOT EXISTS public.tracker_page_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id text,
  user_id text,
  page_path text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  heartbeats integer DEFAULT 0,
  details jsonb,
  created_at timestamptz DEFAULT now()
);

-- ─── ghl_oauth_tokens ───
CREATE TABLE IF NOT EXISTS public.ghl_oauth_tokens (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  location_id text,
  company_id text,
  updated_at timestamptz DEFAULT now()
);

-- ─── ghl_cache_locations ───
CREATE TABLE IF NOT EXISTS public.ghl_cache_locations (
  tenant_id uuid REFERENCES public.tenants(id),
  location_id text,
  location_name text,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (tenant_id, location_id)
);

-- ─── ghl_cache_users ───
CREATE TABLE IF NOT EXISTS public.ghl_cache_users (
  user_id text,
  user_name text,
  tenant_id uuid REFERENCES public.tenants(id),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id)
);

-- ─── alerts ───
CREATE TABLE IF NOT EXISTS public.alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id),
  type text,
  message text,
  metadata jsonb,
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- ─── settings ───
CREATE TABLE IF NOT EXISTS public.settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),
  timezone text,
  working_hours jsonb,
  thresholds jsonb,
  enabled_events jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
