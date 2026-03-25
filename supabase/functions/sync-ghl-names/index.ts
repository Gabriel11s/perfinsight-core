/**
 * sync-ghl-names — On-demand GHL name sync edge function
 *
 * Called by:
 * - Frontend "Force Refresh" button (Settings page)
 * - Auto-sync triggered by useTrackerSessions when unknown IDs are detected
 *
 * Phases:
 * 4a   — Bulk location discovery (GET /locations/search?companyId=...)
 * 4a-ii — Bulk user discovery (GET /users/search?companyId=...)
 * 4b   — RPC-based uncached ID discovery + stale Unknown User retry
 * 5    — Individual location lookups
 * 5b   — Individual user lookups (writes "Unknown User" for confirmed failures)
 * 7    — Backfill orphaned sessions
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  bulkDiscoverLocations,
  bulkDiscoverUsers,
  getGhlToken,
  getStaleUnknownUserIds,
  individualLocationLookups,
  individualUserLookups,
} from "../_shared/ghl-sync.ts";

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
    // ── Auth ───────────────────────────────────────────────────────────────
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

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Tenant resolution ──────────────────────────────────────────────────
    const { data: membership } = await admin
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();
    if (!membership) throw new Error("No tenant found for user");
    const tenantId = membership.tenant_id;

    // ── Mode ───────────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const forceRefresh = body.forceRefresh === true;

    // ── GHL token ──────────────────────────────────────────────────────────
    const { token, companyId } = await getGhlToken(admin, tenantId);
    const ghlHeaders = {
      Authorization: `Bearer ${token}`,
      Version: "2021-07-28",
      Accept: "application/json",
    };

    // ─── Phase 4a: Bulk location discovery ──────────────────────────────────
    let apiLocationsDiscovered = 0;
    let apiLocationErrors: string[] = [];

    if (companyId) {
      console.log(`Discovering locations for company ${companyId}…`);
      const result = await bulkDiscoverLocations(
        admin,
        tenantId,
        companyId,
        ghlHeaders,
      );
      apiLocationsDiscovered = result.discovered;
      apiLocationErrors = result.errors;
      console.log(`Discovered ${apiLocationsDiscovered} locations from GHL API`);
    } else {
      console.log("No companyId stored — skipping proactive location discovery");
    }

    // ─── Phase 4a-ii: Bulk user discovery ────────────────────────────────────
    let apiUsersDiscovered = 0;
    let apiUserErrors: string[] = [];

    if (companyId) {
      console.log(`Discovering users for company ${companyId}…`);
      const result = await bulkDiscoverUsers(
        admin,
        tenantId,
        companyId,
        ghlHeaders,
      );
      apiUsersDiscovered = result.discovered;
      apiUserErrors = result.errors;
      console.log(`Discovered ${apiUsersDiscovered} users from GHL API`);
    }

    // ─── Phase 4b: RPC-based ID discovery + stale Unknown User retry ─────────
    // forceRefresh → get_unique_ghl_ids (all IDs ever seen, for full re-scan)
    // incremental  → get_uncached_ghl_ids (only IDs not yet in cache)
    const rpcName = forceRefresh ? "get_unique_ghl_ids" : "get_uncached_ghl_ids";
    const { data: items, error: rpcErr } = await admin.rpc(rpcName, {
      p_tenant_id: tenantId,
    });
    if (rpcErr) throw new Error(`RPC error: ${rpcErr.message}`);

    const locationIds = (items ?? [])
      .filter((r: any) => r.item_type === "location")
      .map((r: any) => r.id as string);

    const uncachedUserIds: string[] = (items ?? [])
      .filter((r: any) => r.item_type === "user")
      .map((r: any) => r.id as string);

    // Include stale "Unknown User" entries — retry them every 7 days
    const staleUserIds = await getStaleUnknownUserIds(admin, tenantId);
    const userIds = [...new Set([...uncachedUserIds, ...staleUserIds])];

    console.log(
      `Mode: ${forceRefresh ? "full" : "incremental"} | ` +
        `API locations: ${apiLocationsDiscovered} | ` +
        `RPC locations: ${locationIds.length} | ` +
        `Uncached users: ${uncachedUserIds.length} | ` +
        `Stale unknowns to retry: ${staleUserIds.length}`,
    );

    // ─── Phase 5: Individual location lookups ───────────────────────────────
    let locationsUpserted = 0;
    let locationErrors: string[] = [];

    if (locationIds.length > 0) {
      const result = await individualLocationLookups(
        admin,
        tenantId,
        locationIds,
        ghlHeaders,
      );
      locationsUpserted = result.upserted;
      locationErrors = result.errors;
    }

    // ─── Phase 5b: Individual user lookups ──────────────────────────────────
    // Handles uncached users AND stale "Unknown User" retries.
    // Always writes "Unknown User" for confirmed failures (resets 7-day retry timer).
    let usersUpserted = 0;
    let unknownCount = 0;
    let userErrors: string[] = [];

    if (userIds.length > 0) {
      const result = await individualUserLookups(
        admin,
        tenantId,
        userIds,
        ghlHeaders,
      );
      usersUpserted = result.upserted;
      unknownCount = result.unknownCount;
      userErrors = result.errors;
    }

    console.log(
      `Done — Locations: ${locationsUpserted}/${locationIds.length}, ` +
        `Users: ${usersUpserted} resolved, ${unknownCount} confirmed unknown`,
    );

    // ─── Phase 7: Backfill orphaned sessions ────────────────────────────────
    let sessionsClaimed = 0;
    if (locationsUpserted > 0 || apiLocationsDiscovered > 0 || forceRefresh) {
      const { data: backfillResult, error: backfillErr } = await admin.rpc(
        "backfill_orphaned_sessions",
        { p_tenant_id: tenantId },
      );
      if (backfillErr) {
        console.warn("Backfill warning:", backfillErr.message);
      } else {
        sessionsClaimed = backfillResult ?? 0;
        console.log(`Backfilled ${sessionsClaimed} orphaned sessions`);
      }
    }

    return new Response(
      JSON.stringify({
        apiLocationsDiscovered,
        apiUsersDiscovered,
        locationsUpserted,
        usersUpserted,
        unknownCount,
        staleRetried: staleUserIds.length,
        sessionsClaimed,
        locationErrors: locationErrors.length ? locationErrors : undefined,
        apiLocationErrors: apiLocationErrors.length
          ? apiLocationErrors
          : undefined,
        apiUserErrors: apiUserErrors.length ? apiUserErrors : undefined,
        userErrors: userErrors.length ? userErrors : undefined,
        mode: forceRefresh ? "full" : "incremental",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("sync-ghl-names error:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
