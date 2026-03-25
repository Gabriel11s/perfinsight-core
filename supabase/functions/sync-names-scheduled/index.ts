/**
 * sync-names-scheduled — Nightly cron edge function
 *
 * Runs at 3 AM UTC daily (configured via supabase/config.toml).
 * Syncs GHL user and location names for ALL tenants that have a valid OAuth token.
 *
 * Handles:
 * - New uncached user IDs (from tracker_page_sessions)
 * - Stale "Unknown User" entries (retried every 7 days)
 * - Token refresh for tenants with expiring tokens
 *
 * Auth: verifies X-Cron-Secret header against CRON_SECRET env var.
 * This prevents unauthorized invocations since verify_jwt = false.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  bulkDiscoverLocations,
  bulkDiscoverUsers,
  delay,
  getGhlToken,
  getStaleUnknownUserIds,
  individualLocationLookups,
  individualUserLookups,
} from "../_shared/ghl-sync.ts";

/** Delay between tenants to avoid overwhelming GHL API across all accounts. */
const INTER_TENANT_DELAY_MS = 1000;

Deno.serve(async (req) => {
  // Verify cron secret — prevents unauthorized calls since verify_jwt = false
  const cronSecret = Deno.env.get("CRON_SECRET");
  const incomingSecret = req.headers.get("X-Cron-Secret");

  // Allow Supabase's own internal cron invocations (no header needed when
  // invoked via the Supabase scheduler directly), but block external callers
  // without the secret.
  if (cronSecret && incomingSecret !== cronSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  console.log("sync-names-scheduled: starting nightly sync…");

  // 1. Fetch all tenants that have a GHL OAuth token
  const { data: tokens, error: tokensErr } = await admin
    .from("ghl_oauth_tokens")
    .select("tenant_id, company_id, expires_at");

  if (tokensErr) {
    console.error("Failed to fetch token list:", tokensErr.message);
    return new Response(
      JSON.stringify({ error: tokensErr.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const results: Record<string, any> = {};
  let tenantsProcessed = 0;
  let tenantsSkipped = 0;

  // 2. Process each tenant
  for (const row of tokens ?? []) {
    const tenantId: string = row.tenant_id;

    // Skip tenants with an already-expired token (can't refresh without a valid
    // refresh token — these need manual reconnection in the GHL settings page)
    const expiresAt = new Date(row.expires_at);
    if (expiresAt < new Date(Date.now() - 24 * 60 * 60 * 1000)) {
      // Token expired more than 24h ago — skip
      console.log(
        `Tenant ${tenantId}: token expired at ${row.expires_at} — skipping`,
      );
      results[tenantId] = { skipped: true, reason: "token_expired" };
      tenantsSkipped++;
      continue;
    }

    try {
      console.log(`\n── Tenant ${tenantId} ──`);

      // 3. Get/refresh token
      const { token, companyId } = await getGhlToken(admin, tenantId);
      const ghlHeaders = {
        Authorization: `Bearer ${token}`,
        Version: "2021-07-28",
        Accept: "application/json",
      };

      let locDiscovered = 0;
      let userDiscovered = 0;
      const allErrors: string[] = [];

      // 4. Bulk discovery (locations + users via agency-level search)
      if (companyId) {
        const locResult = await bulkDiscoverLocations(
          admin,
          tenantId,
          companyId,
          ghlHeaders,
        );
        locDiscovered = locResult.discovered;
        allErrors.push(...locResult.errors);

        const userResult = await bulkDiscoverUsers(
          admin,
          tenantId,
          companyId,
          ghlHeaders,
        );
        userDiscovered = userResult.discovered;
        allErrors.push(...userResult.errors);
      } else {
        console.log(
          `Tenant ${tenantId}: no companyId — skipping bulk discovery`,
        );
      }

      // 5. Find remaining uncached IDs from sessions
      const { data: uncachedItems } = await admin.rpc("get_uncached_ghl_ids", {
        p_tenant_id: tenantId,
      });

      const uncachedLocationIds = (uncachedItems ?? [])
        .filter((r: any) => r.item_type === "location")
        .map((r: any) => r.id as string);

      const uncachedUserIds = (uncachedItems ?? [])
        .filter((r: any) => r.item_type === "user")
        .map((r: any) => r.id as string);

      // 6. Also include stale "Unknown User" entries for retry
      const staleUserIds = await getStaleUnknownUserIds(admin, tenantId);

      // Merge uncached + stale, de-duplicate
      const allUserIds = [...new Set([...uncachedUserIds, ...staleUserIds])];

      console.log(
        `Tenant ${tenantId}: ${uncachedLocationIds.length} uncached locations, ` +
          `${uncachedUserIds.length} uncached users, ${staleUserIds.length} stale unknowns`,
      );

      // 7. Individual location lookups
      let locsUpserted = 0;
      if (uncachedLocationIds.length > 0) {
        const locLookup = await individualLocationLookups(
          admin,
          tenantId,
          uncachedLocationIds,
          ghlHeaders,
        );
        locsUpserted = locLookup.upserted;
        allErrors.push(...locLookup.errors);
      }

      // 8. Individual user lookups (uncached + stale unknowns)
      let usersUpserted = 0;
      let unknownCount = 0;
      if (allUserIds.length > 0) {
        const userLookup = await individualUserLookups(
          admin,
          tenantId,
          allUserIds,
          ghlHeaders,
        );
        usersUpserted = userLookup.upserted;
        unknownCount = userLookup.unknownCount;
        allErrors.push(...userLookup.errors);
      }

      // 9. Always run backfill to claim any orphaned rows for this tenant.
      //    The RPC is a no-op if there are no null-tenant rows, so it's safe to run
      //    unconditionally. This catches orphaned rows that arrived between nightly
      //    syncs when all location names were already cached (no new locations found
      //    = the old condition would skip backfill entirely, leaving them unclaimed).
      let sessionsClaimed = 0;
      const { data: backfillResult } = await admin.rpc(
        "backfill_orphaned_sessions",
        { p_tenant_id: tenantId },
      );
      sessionsClaimed = backfillResult ?? 0;

      results[tenantId] = {
        locDiscovered,
        userDiscovered,
        locsUpserted,
        usersUpserted,
        unknownCount,
        staleRetried: staleUserIds.length,
        sessionsClaimed,
        errors: allErrors.length ? allErrors : undefined,
      };

      console.log(
        `Tenant ${tenantId} done: +${usersUpserted} users resolved, ` +
          `${unknownCount} confirmed unknown, ${staleUserIds.length} stale retried`,
      );

      tenantsProcessed++;
    } catch (e: any) {
      console.error(`Tenant ${tenantId} failed:`, e.message);
      results[tenantId] = { error: e.message };
    }

    // Rate-limit between tenants
    await delay(INTER_TENANT_DELAY_MS);
  }

  console.log(
    `\nsync-names-scheduled complete: ${tenantsProcessed} processed, ${tenantsSkipped} skipped`,
  );

  return new Response(
    JSON.stringify({
      tenantsProcessed,
      tenantsSkipped,
      results,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
