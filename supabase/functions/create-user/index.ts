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
    // 1. Verify the calling user is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth header");

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

    // 2. Verify caller is a tenant owner
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: membership } = await admin
      .from("tenant_members")
      .select("role, tenant_id")
      .eq("user_id", user.id)
      .eq("role", "owner")
      .maybeSingle();

    if (!membership) {
      throw new Error("Only tenant owners can create users");
    }

    // 3. Create the user
    const { email, password } = await req.json();
    if (!email || !password) throw new Error("email and password required");

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;

    // 4. Add the new user to the caller's tenant as a member.
    //    Without this step the user can authenticate but sees a blank
    //    dashboard because useAuth finds no tenant_members row.
    const { error: memberError } = await admin
      .from("tenant_members")
      .insert({
        tenant_id: membership.tenant_id,
        user_id: data.user.id,
        role: "member",
      });
    if (memberError) {
      // Auth user was created — roll it back to avoid an orphaned account
      await admin.auth.admin.deleteUser(data.user.id);
      throw new Error(`Tenant assignment failed: ${memberError.message}`);
    }

    return new Response(
      JSON.stringify({ user: data.user, tenant_id: membership.tenant_id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("create-user error:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
