-- =========================================================================================
-- MIGRATION: 027_user_presence.sql
-- PURPOSE: Real-time online status tracking for GHL users.
--          The tracker script sends a heartbeat every 30 seconds to the tracker-heartbeat
--          edge function, which upserts into this table. Frontend polls every 15 seconds.
--          pg_cron cleans up stale rows every 5 minutes.
-- =========================================================================================

-- 1. Table
CREATE TABLE IF NOT EXISTS public.user_presence (
  user_id      text        NOT NULL,
  location_id  text        NOT NULL,
  tenant_id    uuid        REFERENCES public.tenants(id),
  page_path    text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_presence_last_seen
  ON public.user_presence (tenant_id, last_seen_at DESC);

-- 2. RLS
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view presence"
  ON public.user_presence FOR SELECT
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm WHERE tm.user_id = auth.uid()
    )
  );

-- 3. Upsert RPC — resolves tenant_id server-side (avoids trigger-filled upsert ambiguity)
CREATE OR REPLACE FUNCTION public.upsert_user_presence(
  p_user_id     text,
  p_location_id text,
  p_page_path   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  -- Resolve tenant_id using the same logic as the auto_fill triggers
  SELECT tenant_id INTO v_tenant_id
  FROM public.ghl_cache_locations
  WHERE location_id = p_location_id
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    SELECT tenant_id INTO v_tenant_id
    FROM public.ghl_oauth_tokens
    WHERE location_id = p_location_id
    LIMIT 1;
  END IF;

  -- If we can't resolve tenant, skip silently (orphaned location)
  IF v_tenant_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.user_presence (user_id, location_id, tenant_id, page_path, last_seen_at)
  VALUES (p_user_id, p_location_id, v_tenant_id, p_page_path, now())
  ON CONFLICT (tenant_id, user_id)
  DO UPDATE SET
    location_id  = EXCLUDED.location_id,
    page_path    = EXCLUDED.page_path,
    last_seen_at = EXCLUDED.last_seen_at;

  -- Replicate to other tenants sharing this location
  PERFORM public.replicate_presence(p_user_id, p_location_id, p_page_path, v_tenant_id);
END;
$$;

-- 4. Replication function — copies presence to all OTHER tenants at this location
CREATE OR REPLACE FUNCTION public.replicate_presence(
  p_user_id     text,
  p_location_id text,
  p_page_path   text,
  p_source_tenant uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  other_tenant uuid;
BEGIN
  FOR other_tenant IN
    SELECT tenant_id FROM public.ghl_cache_locations
    WHERE location_id = p_location_id
      AND tenant_id IS DISTINCT FROM p_source_tenant
  LOOP
    INSERT INTO public.user_presence (user_id, location_id, tenant_id, page_path, last_seen_at)
    VALUES (p_user_id, p_location_id, other_tenant, p_page_path, now())
    ON CONFLICT (tenant_id, user_id)
    DO UPDATE SET
      location_id  = EXCLUDED.location_id,
      page_path    = EXCLUDED.page_path,
      last_seen_at = EXCLUDED.last_seen_at;
  END LOOP;
END;
$$;

-- 5. pg_cron: cleanup stale presence rows every 5 minutes
SELECT cron.schedule(
  'cleanup-stale-presence',
  '*/5 * * * *',
  $$DELETE FROM public.user_presence WHERE last_seen_at < now() - interval '5 minutes'$$
);
