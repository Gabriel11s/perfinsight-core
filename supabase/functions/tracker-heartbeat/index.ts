import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * tracker-heartbeat Edge Function
 *
 * Receives lightweight presence heartbeats from the GHL tracker script every 30 seconds.
 * Upserts into user_presence table via RPC (tenant_id resolved server-side).
 *
 * Also handles offline signals: POST with action:"offline" deletes presence rows.
 * sendBeacon (used during beforeunload) only supports POST, so we use the action
 * field to distinguish heartbeat vs. offline signals.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { user_id, location_id, page_path, action } = await req.json();

    if (!user_id || !location_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing user_id or location_id" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (action === "offline") {
      // User is leaving — delete their presence rows across all tenants
      const { error } = await admin.rpc("delete_user_presence", {
        p_user_id: user_id,
        p_location_id: location_id,
      });
      if (error) {
        console.warn("Presence delete error:", error.message);
      }
    } else {
      // Regular heartbeat — upsert presence
      const { error } = await admin.rpc("upsert_user_presence", {
        p_user_id: user_id,
        p_location_id: location_id,
        p_page_path: page_path || null,
      });
      if (error) {
        console.warn("Presence upsert error:", error.message);
      }
    }

    return new Response(
      JSON.stringify({ ok: true }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error: any) {
    console.error("tracker-heartbeat error:", error.message);
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
