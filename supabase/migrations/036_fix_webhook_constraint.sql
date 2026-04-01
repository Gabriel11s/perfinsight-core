-- =================================================================
-- Fix: Replace partial unique index with proper unique constraint
-- for ON CONFLICT support in replication trigger
-- =================================================================

-- Drop the broken partial unique index (doesn't support ON CONFLICT)
DROP INDEX IF EXISTS public.idx_ghl_events_webhook_tenant;

-- Create a proper unique constraint that ON CONFLICT can reference
-- This allows NULL values (Postgres treats NULLs as distinct in unique constraints)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_ghl_events_webhook_tenant'
  ) THEN
    ALTER TABLE public.ghl_events
      ADD CONSTRAINT uq_ghl_events_webhook_tenant UNIQUE (webhook_id, tenant_id);
  END IF;
END $$;
