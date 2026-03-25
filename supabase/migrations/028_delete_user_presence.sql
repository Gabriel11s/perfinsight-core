-- =========================================================================================
-- MIGRATION: 028_delete_user_presence.sql
-- PURPOSE: Add RPC to delete presence rows when a user leaves GHL.
--          Called by tracker-heartbeat DELETE method for instant offline detection.
-- =========================================================================================

CREATE OR REPLACE FUNCTION public.delete_user_presence(
  p_user_id     text,
  p_location_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Delete presence for this user across ALL tenants that share this location.
  -- This handles multi-tenant scenarios where a single location_id maps to multiple tenants.
  DELETE FROM public.user_presence
  WHERE user_id = p_user_id
    AND location_id = p_location_id;
END;
$$;
