import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GHL_API = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

/**
 * sync-ghl-data Edge Function
 *
 * Pulls contacts and opportunities from the GHL API and creates
 * synthetic ghl_events for any changes detected since last sync.
 * This replaces webhooks when they're unreliable.
 *
 * Runs on a cron schedule (every 5 minutes).
 */

interface GhlToken {
  tenant_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  location_id: string;
  company_id: string;
}

// ── Refresh token if expired ────────────────────────────
async function refreshTokenIfNeeded(
  admin: any,
  token: GhlToken,
): Promise<string> {
  const expiresAt = new Date(token.expires_at);
  const now = new Date();

  // Refresh 5 minutes before expiry
  if (expiresAt.getTime() - now.getTime() > 5 * 60 * 1000) {
    return token.access_token;
  }

  console.log(`Token expired for ${token.location_id}, refreshing...`);

  const clientId = Deno.env.get("GHL_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GHL_CLIENT_SECRET")!;

  const res = await fetch("https://services.leadconnectorhq.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed: ${res.status} - ${err}`);
  }

  const data = await res.json();
  const newExpiresAt = new Date(
    Date.now() + (data.expires_in || 86400) * 1000,
  ).toISOString();

  await admin
    .from("ghl_oauth_tokens")
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token || token.refresh_token,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", token.tenant_id);

  return data.access_token;
}

// ── Fetch contacts from GHL ────────────────────────────
async function fetchRecentContacts(
  accessToken: string,
  locationId: string,
  sinceMinutes: number = 10,
): Promise<any[]> {
  const since = new Date(Date.now() - sinceMinutes * 60 * 1000).toISOString();
  const contacts: any[] = [];
  let startAfterId: string | null = null;
  let startAfter: number | null = null;
  let page = 0;

  while (page < 5) {
    // Max 5 pages (500 contacts)
    let url = `${GHL_API}/contacts/?locationId=${locationId}&limit=100&sortBy=date_updated&order=desc`;
    if (startAfterId && startAfter) {
      url += `&startAfterId=${startAfterId}&startAfter=${startAfter}`;
    }

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: GHL_VERSION,
      },
    });

    if (!res.ok) {
      console.error(`Contacts API error: ${res.status}`);
      break;
    }

    const data = await res.json();
    const batch = data.contacts || [];

    for (const c of batch) {
      // Only process contacts updated since last sync
      if (c.dateUpdated && new Date(c.dateUpdated) < new Date(since)) {
        return contacts; // Reached older contacts, stop
      }
      contacts.push(c);
    }

    if (batch.length < 100) break; // No more pages

    // Pagination
    startAfterId = data.meta?.startAfterId;
    startAfter = data.meta?.startAfter;
    if (!startAfterId) break;

    page++;
  }

  return contacts;
}

// ── Fetch opportunities from GHL ────────────────────────
async function fetchRecentOpportunities(
  accessToken: string,
  locationId: string,
): Promise<any[]> {
  const opportunities: any[] = [];

  // Get all pipelines first
  const pipeRes = await fetch(
    `${GHL_API}/opportunities/pipelines?locationId=${locationId}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: GHL_VERSION,
      },
    },
  );

  if (!pipeRes.ok) {
    console.error(`Pipelines API error: ${pipeRes.status}`);
    return [];
  }

  const pipeData = await pipeRes.json();
  const pipelines = pipeData.pipelines || [];

  for (const pipeline of pipelines) {
    const res = await fetch(
      `${GHL_API}/opportunities/search?location_id=${locationId}&pipeline_id=${pipeline.id}&limit=50&order=added_desc`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Version: GHL_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          location_id: locationId,
          pipeline_id: pipeline.id,
        }),
      },
    );

    if (!res.ok) {
      console.error(`Opportunities API error: ${res.status}`);
      continue;
    }

    const data = await res.json();
    opportunities.push(...(data.opportunities || []));
  }

  return opportunities;
}

// ── Create synthetic events ────────────────────────────
async function syncContacts(
  admin: any,
  contacts: any[],
  locationId: string,
): Promise<number> {
  let created = 0;

  for (const c of contacts) {
    const contactId = c.id;
    const userId = c.assignedTo || null;
    const source = c.source || null;

    // Check if we already have this contact's latest state
    const { data: existing } = await admin
      .from("ghl_events")
      .select("id,user_id")
      .eq("contact_id", contactId)
      .in("event_type", ["ContactCreate", "ContactUpdate"])
      .order("event_date", { ascending: false })
      .limit(1);

    const lastEvent = existing?.[0];
    const lastUserId = lastEvent?.user_id || null;

    if (!lastEvent) {
      // No event for this contact — create a ContactCreate
      const { error } = await admin.from("ghl_events").insert({
        location_id: locationId,
        event_type: "ContactCreate",
        user_id: userId,
        contact_id: contactId,
        event_data: {
          source: source,
          contact: { source },
          firstName: c.firstName,
          lastName: c.lastName,
          phone: c.phone,
          email: c.email,
          assignedTo: userId,
          tags: c.tags || [],
        },
        event_date: c.dateAdded || new Date().toISOString(),
        webhook_id: `sync-create-${contactId}`,
      });

      if (!error) created++;
      else if (error.code !== "23505") {
        // Ignore duplicates
        console.error(`Insert ContactCreate error: ${error.message}`);
      }
    } else if (userId && userId !== lastUserId) {
      // Owner changed — create a ContactUpdate
      const { error } = await admin.from("ghl_events").insert({
        location_id: locationId,
        event_type: "ContactUpdate",
        user_id: userId,
        contact_id: contactId,
        event_data: {
          source: source,
          contact: { source },
          assignedTo: userId,
          previousAssignedTo: lastUserId,
          firstName: c.firstName,
          lastName: c.lastName,
        },
        event_date: c.dateUpdated || new Date().toISOString(),
        webhook_id: `sync-update-${contactId}-${Date.now()}`,
      });

      if (!error) created++;
      else if (error.code !== "23505") {
        console.error(`Insert ContactUpdate error: ${error.message}`);
      }
    }
  }

  return created;
}

async function syncOpportunities(
  admin: any,
  opportunities: any[],
  locationId: string,
): Promise<number> {
  let created = 0;

  for (const opp of opportunities) {
    const contactId = opp.contactId || opp.contact?.id || null;
    const status = opp.status || "open";
    const monetaryValue = opp.monetaryValue || 0;
    const assignedTo = opp.assignedTo || null;

    // Check if we already have this opportunity
    const { data: existing } = await admin
      .from("ghl_events")
      .select("id")
      .eq("contact_id", contactId)
      .in("event_type", [
        "OpportunityCreate",
        "OpportunityStatusUpdate",
      ])
      .eq("event_data->>opportunityId", opp.id)
      .limit(1);

    if (existing && existing.length > 0) continue; // Already tracked

    const eventType =
      status === "won" || status === "lost"
        ? "OpportunityStatusUpdate"
        : "OpportunityCreate";

    const { error } = await admin.from("ghl_events").insert({
      location_id: locationId,
      event_type: eventType,
      user_id: assignedTo,
      contact_id: contactId,
      event_data: {
        opportunityId: opp.id,
        status: status,
        opportunity: {
          status: status,
          monetaryValue: String(monetaryValue),
          name: opp.name,
          pipelineId: opp.pipelineId,
          stageId: opp.pipelineStageId,
        },
        assignedTo: assignedTo,
      },
      event_date: opp.createdAt || new Date().toISOString(),
      webhook_id: `sync-opp-${opp.id}`,
    });

    if (!error) created++;
    else if (error.code !== "23505") {
      console.error(`Insert Opportunity error: ${error.message}`);
    }
  }

  return created;
}

// ── Main handler ────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Get all OAuth tokens
    const { data: tokens, error: tokErr } = await admin
      .from("ghl_oauth_tokens")
      .select("*");

    if (tokErr || !tokens?.length) {
      console.log("No GHL tokens found, nothing to sync");
      return new Response(
        JSON.stringify({ ok: true, message: "No tokens" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const results: any[] = [];

    for (const token of tokens) {
      try {
        const accessToken = await refreshTokenIfNeeded(admin, token);

        // Sync contacts (last 10 minutes)
        const contacts = await fetchRecentContacts(
          accessToken,
          token.location_id,
          10,
        );
        const contactEvents = await syncContacts(
          admin,
          contacts,
          token.location_id,
        );

        // Sync opportunities
        const opportunities = await fetchRecentOpportunities(
          accessToken,
          token.location_id,
        );
        const oppEvents = await syncOpportunities(
          admin,
          opportunities,
          token.location_id,
        );

        results.push({
          location: token.location_id,
          contacts_fetched: contacts.length,
          contacts_synced: contactEvents,
          opportunities_fetched: opportunities.length,
          opportunities_synced: oppEvents,
        });

        console.log(
          `Synced ${token.location_id}: ${contacts.length} contacts (${contactEvents} new), ${opportunities.length} opps (${oppEvents} new)`,
        );
      } catch (e: any) {
        console.error(
          `Sync error for ${token.location_id}: ${e.message}`,
        );
        results.push({
          location: token.location_id,
          error: e.message,
        });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, results }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error: any) {
    console.error("sync-ghl-data error:", error.message);
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
