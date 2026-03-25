import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const AUTH_URL =
  "https://marketplace.gohighlevel.com/oauth/chooselocation";

// UUID v4 format check
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");

    const clientId = Deno.env.get("GHL_CLIENT_ID");
    const clientSecret = Deno.env.get("GHL_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      throw new Error("Credentials not configured");
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // --- STEP 1: Initiate OAuth (no code yet) ---
    if (!code) {
      const tenantId = url.searchParams.get("tenant_id");
      const redirectUrl = url.searchParams.get("redirect_url") || "";
      if (!tenantId) throw new Error("tenant_id is required");

      const state = btoa(
        JSON.stringify({ tenant_id: tenantId, redirect_url: redirectUrl }),
      );
      const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/integration-callback`;

      const scopes = 'locations.readonly users.readonly calendars/events.readonly calendars.readonly conversations.readonly conversations/message.readonly contacts.readonly locations/tasks.readonly locations/tags.readonly opportunities.readonly';

      const authUrl =
        `${AUTH_URL}?response_type=code` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&client_id=${clientId}` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&state=${encodeURIComponent(state)}`;

      return new Response(null, {
        status: 302,
        headers: { ...corsHeaders, Location: authUrl },
      });
    }

    // --- STEP 2: Handle callback (code present) ---
    const stateParam = url.searchParams.get("state") || "";
    let tenantId: string;
    let redirectUrl: string;

    try {
      const parsed = JSON.parse(atob(stateParam));
      tenantId = parsed.tenant_id;
      redirectUrl = parsed.redirect_url || "";
    } catch {
      throw new Error("Invalid state parameter");
    }

    if (!tenantId) throw new Error("No tenant_id in state");

    // Validate tenant_id is a real UUID to prevent injection
    if (!UUID_RE.test(tenantId)) {
      throw new Error("Invalid tenant_id format");
    }

    // Verify tenant actually exists
    const { data: tenantRow } = await admin
      .from("tenants")
      .select("id")
      .eq("id", tenantId)
      .maybeSingle();
    if (!tenantRow) throw new Error("Tenant not found");

    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/integration-callback`;

    // Exchange code for tokens
    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      throw new Error(
        `Token exchange failed: ${tokenRes.status} - ${errText}`,
      );
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const expiresIn = tokenData.expires_in || 86400;
    const locationId =
      tokenData.locationId || tokenData.location_id || null;
    const companyId =
      tokenData.companyId || tokenData.company_id || null;

    if (!accessToken) throw new Error("No access_token in response");

    const expiresAt = new Date(
      Date.now() + expiresIn * 1000,
    ).toISOString();

    // Upsert tokens
    const { error: upsertError } = await admin
      .from("ghl_oauth_tokens")
      .upsert(
        {
          tenant_id: tenantId,
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_at: expiresAt,
          location_id: locationId,
          company_id: companyId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id" },
      );

    if (upsertError) {
      throw new Error(`Failed to save tokens: ${upsertError.message}`);
    }

    // Redirect back to app
    const finalRedirect = redirectUrl
      ? `${redirectUrl}?ghl=connected`
      : "about:blank";

    return new Response(null, {
      status: 302,
      headers: { Location: finalRedirect },
    });
  } catch (error: any) {
    console.error("integration-callback error:", error.message);
    const reqUrl = new URL(req.url);
    const stateParam = reqUrl.searchParams.get("state");
    let redirectUrl = "";
    try {
      if (stateParam) {
        const parsed = JSON.parse(atob(stateParam));
        redirectUrl = parsed.redirect_url || "";
      }
    } catch {
      /* ignore */
    }

    if (redirectUrl) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${redirectUrl}?ghl=error&message=${encodeURIComponent(error.message)}`,
        },
      });
    }

    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
