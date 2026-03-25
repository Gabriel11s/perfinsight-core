-- =================================================================
-- GHL Activity Events — captures webhooks from GoHighLevel
-- Run this in Supabase SQL Editor
-- =================================================================

-- 1. Create the unified events table
CREATE TABLE IF NOT EXISTS public.ghl_events (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     uuid REFERENCES public.tenants(id),
  location_id   text NOT NULL,
  event_type    text NOT NULL,
  user_id       text,
  contact_id    text,
  event_data    jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_date    timestamptz NOT NULL,
  webhook_id    text,
  created_at    timestamptz DEFAULT now()
);

-- 2. Indices for dashboard queries
CREATE INDEX IF NOT EXISTS idx_ghl_events_tenant_date
  ON public.ghl_events(tenant_id, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_ghl_events_type
  ON public.ghl_events(tenant_id, event_type, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_ghl_events_user
  ON public.ghl_events(tenant_id, user_id, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_ghl_events_location
  ON public.ghl_events(tenant_id, location_id, event_date DESC);

-- Unique constraint to prevent duplicate webhook processing
CREATE UNIQUE INDEX IF NOT EXISTS idx_ghl_events_webhook_id
  ON public.ghl_events(webhook_id)
  WHERE webhook_id IS NOT NULL;

-- 3. RLS — only tenant members can read their own events
ALTER TABLE public.ghl_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_select_events" ON public.ghl_events;
CREATE POLICY "tenant_select_events" ON public.ghl_events
  FOR SELECT TO authenticated USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid()
    )
  );

-- 4. Trigger to auto-fill tenant_id from location_id (same pattern as tracker sessions)
CREATE OR REPLACE FUNCTION public.auto_fill_event_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tenant_id IS NULL AND NEW.location_id IS NOT NULL THEN
    SELECT tenant_id INTO NEW.tenant_id
    FROM public.ghl_cache_locations
    WHERE location_id = NEW.location_id
    LIMIT 1;
  END IF;

  IF NEW.tenant_id IS NULL AND NEW.location_id IS NOT NULL THEN
    SELECT tenant_id INTO NEW.tenant_id
    FROM public.ghl_oauth_tokens
    WHERE location_id = NEW.location_id
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_event_tenant_id ON public.ghl_events;
CREATE TRIGGER trg_auto_event_tenant_id
  BEFORE INSERT ON public.ghl_events
  FOR EACH ROW
  EXECUTE FUNCTION auto_fill_event_tenant_id();


-- 5. Add enabled_events to settings table (tenants can toggle dashboard visibility)
ALTER TABLE public.settings
ADD COLUMN IF NOT EXISTS enabled_events jsonb
DEFAULT '{
  "AppointmentCreate": true,
  "AppointmentUpdate": true,
  "AppointmentDelete": false,
  "ContactCreate": true,
  "ContactUpdate": false,
  "ContactDelete": false,
  "ContactDndUpdate": false,
  "ContactTagUpdate": false,
  "ConversationUnreadUpdate": false,
  "InboundMessage": true,
  "OutboundMessage": true,
  "TaskCreate": true,
  "TaskComplete": true,
  "TaskDelete": false,
  "OpportunityCreate": true,
  "OpportunityUpdate": false,
  "OpportunityDelete": false,
  "OpportunityStatusUpdate": true,
  "OpportunityStageUpdate": true,
  "OpportunityMonetaryValueUpdate": false,
  "OpportunityAssignedToUpdate": false,
  "NoteCreate": false,
  "NoteUpdate": false,
  "NoteDelete": false,
  "LocationCreate": false,
  "LocationUpdate": false
}'::jsonb;
