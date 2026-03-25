import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth header");

    // Verify calling user
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const {
      data: { user },
      error: authError,
    } = await supabaseUser.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    // Service role for writes
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Check existing membership
    const { data: existing } = await admin
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({
          tenant_id: existing.tenant_id,
          message: "Already set up",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { name } = await req.json().catch(() => ({ name: "My Agency" }));

    // Create tenant
    const { data: tenant, error: tenantErr } = await admin
      .from("tenants")
      .insert({ name, mode: "agency", owner_user_id: user.id })
      .select("id")
      .single();
    if (tenantErr) throw tenantErr;

    // Create membership
    const { error: memberErr } = await admin
      .from("tenant_members")
      .insert({ tenant_id: tenant.id, user_id: user.id, role: "owner" });
    if (memberErr) throw memberErr;

    // Create default settings row
    await admin.from("settings").insert({
      tenant_id: tenant.id,
      timezone: "America/Sao_Paulo",
      working_hours: { start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] },
      thresholds: {
        no_activity_days: 7,
        min_minutes_week: 30,
        usage_drop_pct: 50,
        bounce_threshold_seconds: 10,
        tracker_offline_minutes: 60,
      },
    });

    return new Response(
      JSON.stringify({ tenant_id: tenant.id, message: "Tenant created" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("bootstrap-tenant error:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
