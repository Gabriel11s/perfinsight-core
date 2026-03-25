/**
 * Shared GHL sync utilities used by sync-ghl-names and sync-names-scheduled.
 * Contains all the building blocks for token management, bulk discovery,
 * and individual user/location lookups.
 */

export const GHL_API = "https://services.leadconnectorhq.com";
export const BATCH_DELAY_MS = 200;
export const UNKNOWN_USER = "Unknown User";
export const UNKNOWN_LOCATION = "Unknown Location";

/** Number of days before an "Unknown User" entry is considered stale and retried. */
export const STALE_UNKNOWN_RETRY_DAYS = 7;

export const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── HTTP ──────────────────────────────────────────────────────────────── */

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3,
): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, {
      ...options,
      signal: (options as any)?.signal ?? AbortSignal.timeout(10_000),
    });
    if (res.status === 429) {
      const wait = (i + 1) * 1000;
      console.warn(`Rate limited on ${url}. Retry in ${wait}ms…`);
      await delay(wait);
      continue;
    }
    return res;
  }
  throw new Error(`Failed after ${retries} retries (rate limited): ${url}`);
}

/* ── Token management ──────────────────────────────────────────────────── */

/**
 * Returns a valid GHL access token for the tenant, refreshing if needed.
 * If the refresh token is expired (401/403), clears the stored token and throws.
 */
export async function getGhlToken(
  admin: any,
  tenantId: string,
): Promise<{ token: string; companyId: string | null }> {
  const { data: tokenRow, error } = await admin
    .from("ghl_oauth_tokens")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) throw new Error(`Token query error: ${error.message}`);
  if (!tokenRow) throw new Error("No GHL token found. Connect GHL first.");

  const companyId = tokenRow.company_id ?? null;

  // Return current token if still valid (10-min buffer)
  if (new Date(tokenRow.expires_at) > new Date(Date.now() + 10 * 60_000)) {
    return { token: tokenRow.access_token, companyId };
  }

  // Refresh the token
  console.log(`Refreshing GHL token for tenant ${tenantId}…`);
  const clientId = Deno.env.get("GHL_CLIENT_ID");
  const clientSecret = Deno.env.get("GHL_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("Missing GHL_CLIENT_ID or GHL_CLIENT_SECRET env vars");
  }

  const res = await fetch(`${GHL_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: tokenRow.refresh_token,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401 || res.status === 403) {
      // Refresh token is expired/revoked — clear it so the UI shows reconnect button
      await admin.from("ghl_oauth_tokens").delete().eq("tenant_id", tenantId);
      throw new Error(
        "GHL refresh token expired — token cleared. Please reconnect GHL in Settings.",
      );
    }
    throw new Error(`Token refresh failed (${res.status}): ${body}`);
  }

  const tokens = await res.json();
  const expiresAt = new Date(
    Date.now() + (tokens.expires_in ?? 86400) * 1000,
  ).toISOString();

  await admin
    .from("ghl_oauth_tokens")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId);

  return { token: tokens.access_token, companyId };
}

/* ── Bulk discovery ────────────────────────────────────────────────────── */

/**
 * Fetches all GHL locations for a company (paginated) and batch-upserts them.
 * One DB call per page of 100 — avoids per-row timeout on large agencies.
 */
export async function bulkDiscoverLocations(
  admin: any,
  tenantId: string,
  companyId: string,
  ghlHeaders: Record<string, string>,
): Promise<{ discovered: number; errors: string[] }> {
  let discovered = 0;
  const errors: string[] = [];

  try {
    let skip = 0;
    const limit = 100;

    while (true) {
      const searchRes = await fetchWithRetry(
        `${GHL_API}/locations/search?companyId=${companyId}&skip=${skip}&limit=${limit}`,
        { headers: ghlHeaders },
      );

      if (!searchRes.ok) {
        const errText = await searchRes.text();
        errors.push(`locations/search HTTP ${searchRes.status}: ${errText}`);
        break;
      }

      const searchData = await searchRes.json();
      const locations = searchData.locations ?? [];

      const rows = locations
        .filter((loc: any) => loc.id)
        .map((loc: any) => ({
          tenant_id: tenantId,
          location_id: loc.id,
          location_name: loc.name || loc.id,
          updated_at: new Date().toISOString(),
        }));

      if (rows.length > 0) {
        const { error: upsertErr } = await admin
          .from("ghl_cache_locations")
          .upsert(rows, { onConflict: "tenant_id,location_id" });
        if (upsertErr) {
          errors.push(`Batch upsert: ${upsertErr.message}`);
        } else {
          discovered += rows.length;
        }
      }

      if (locations.length < limit) break;
      skip += limit;
      await delay(BATCH_DELAY_MS);
    }
  } catch (e: any) {
    errors.push(`Discovery error: ${e.message}`);
    console.warn("Location discovery failed:", e.message);
  }

  return { discovered, errors };
}

/**
 * Fetches all GHL agency-level users for a company (paginated) and batch-upserts them.
 * Note: returns agency users only — location sub-users are handled by individualUserLookups().
 */
export async function bulkDiscoverUsers(
  admin: any,
  tenantId: string,
  companyId: string,
  ghlHeaders: Record<string, string>,
): Promise<{ discovered: number; errors: string[] }> {
  let discovered = 0;
  const errors: string[] = [];

  try {
    let skip = 0;
    const limit = 100;

    while (true) {
      const searchRes = await fetchWithRetry(
        `${GHL_API}/users/search?companyId=${companyId}&skip=${skip}&limit=${limit}`,
        { headers: ghlHeaders },
      );

      if (!searchRes.ok) {
        const errText = await searchRes.text();
        errors.push(`users/search HTTP ${searchRes.status}: ${errText}`);
        break;
      }

      const searchData = await searchRes.json();
      const users = searchData.users ?? [];

      const rows = users
        .filter((u: any) => u.id)
        .map((u: any) => ({
          tenant_id: tenantId,
          user_id: u.id,
          user_name:
            u.name ||
            `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() ||
            u.id,
          updated_at: new Date().toISOString(),
        }));

      if (rows.length > 0) {
        const { error: upsertErr } = await admin
          .from("ghl_cache_users")
          .upsert(rows, { onConflict: "tenant_id,user_id" });
        if (upsertErr) {
          errors.push(`Batch upsert: ${upsertErr.message}`);
        } else {
          discovered += rows.length;
        }
      }

      if (users.length < limit) break;
      skip += limit;
      await delay(BATCH_DELAY_MS);
    }
  } catch (e: any) {
    errors.push(`Discovery error: ${e.message}`);
    console.warn("User discovery failed:", e.message);
  }

  return { discovered, errors };
}

/* ── Individual lookups ────────────────────────────────────────────────── */

/**
 * Looks up individual location IDs via GET /locations/{id}.
 * Writes "Unknown Location" placeholder for inaccessible locations so the
 * frontend stops looping on them.
 */
export async function individualLocationLookups(
  admin: any,
  tenantId: string,
  locationIds: string[],
  ghlHeaders: Record<string, string>,
): Promise<{ upserted: number; errors: string[] }> {
  let upserted = 0;
  const errors: string[] = [];

  for (let i = 0; i < locationIds.length; i += 3) {
    const batch = locationIds.slice(i, i + 3);
    await Promise.all(
      batch.map(async (locId: string) => {
        try {
          const res = await fetchWithRetry(
            `${GHL_API}/locations/${locId}`,
            { headers: ghlHeaders },
          );

          let locationName: string;
          if (res.ok) {
            const json = await res.json();
            locationName = json.location?.name ?? json.name ?? locId;
          } else {
            errors.push(`${locId}: HTTP ${res.status}`);
            locationName = UNKNOWN_LOCATION;
          }

          const { error: upsertErr } = await admin
            .from("ghl_cache_locations")
            .upsert(
              {
                tenant_id: tenantId,
                location_id: locId,
                location_name: locationName,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "tenant_id,location_id" },
            );

          if (!upsertErr && res.ok) upserted++;
        } catch (e: any) {
          errors.push(`${locId}: ${e.message}`);
        }
      }),
    );
    if (i + 3 < locationIds.length) await delay(BATCH_DELAY_MS);
  }

  return { upserted, errors };
}

/**
 * Looks up individual user IDs via GET /users/{id}.
 *
 * For users that resolve: upserts the real name.
 * For users that fail (401/403/404): marks as "Unknown User" with updated_at = now(),
 * which resets the 7-day retry timer. They will be retried after STALE_UNKNOWN_RETRY_DAYS.
 *
 * This always writes "Unknown User" for failures (regardless of forceRefresh mode)
 * to prevent infinite frontend auto-sync loops.
 */
export async function individualUserLookups(
  admin: any,
  tenantId: string,
  userIds: string[],
  ghlHeaders: Record<string, string>,
): Promise<{ upserted: number; unknownCount: number; errors: string[] }> {
  let upserted = 0;
  let unknownCount = 0;
  const errors: string[] = [];

  if (userIds.length === 0) return { upserted, unknownCount, errors };

  console.log(`Looking up ${userIds.length} users individually…`);
  const remainingUsers = new Set(userIds);

  for (let i = 0; i < userIds.length; i += 3) {
    if (remainingUsers.size === 0) break;

    const batch = userIds.slice(i, i + 3).filter((uid) =>
      remainingUsers.has(uid)
    );

    await Promise.all(
      batch.map(async (uid: string) => {
        try {
          const res = await fetchWithRetry(
            `${GHL_API}/users/${uid}`,
            { headers: ghlHeaders },
          );

          if (!res.ok) {
            // 401/403/404 = user not accessible via this agency token.
            // Typical for cross-company users replicated via shared location.
            console.warn(`User ${uid}: HTTP ${res.status} — not in agency scope`);
            return;
          }

          const data = await res.json();
          const u = data.user ?? data;
          const userName =
            u.name ||
            `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() ||
            uid;

          const { error: upsertErr } = await admin
            .from("ghl_cache_users")
            .upsert(
              {
                tenant_id: tenantId,
                user_id: uid,
                user_name: userName,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "tenant_id,user_id" },
            );

          if (!upsertErr) {
            remainingUsers.delete(uid);
            upserted++;
            console.log(`Resolved user ${uid} → "${userName}"`);
          }
        } catch (e: any) {
          console.warn(`User lookup failed for ${uid}:`, e.message);
          errors.push(`${uid}: ${e.message}`);
        }
      }),
    );

    if (i + 3 < userIds.length) await delay(BATCH_DELAY_MS);
  }

  // Mark remaining as Unknown User (always — regardless of forceRefresh mode).
  // updated_at = now() resets the 7-day retry timer.
  if (remainingUsers.size > 0) {
    console.log(
      `${remainingUsers.size} users confirmed unresolvable — marking as "${UNKNOWN_USER}"`,
    );
    const unknownRows = [...remainingUsers].map((uid) => ({
      tenant_id: tenantId,
      user_id: uid,
      user_name: UNKNOWN_USER,
      updated_at: new Date().toISOString(),
    }));
    const { error: upsertErr } = await admin
      .from("ghl_cache_users")
      .upsert(unknownRows, { onConflict: "tenant_id,user_id" });
    if (upsertErr) {
      unknownRows.forEach((r) =>
        errors.push(`${r.user_id}: ${upsertErr.message}`)
      );
    } else {
      unknownCount += unknownRows.length;
    }
  }

  return { upserted, unknownCount, errors };
}

/* ── Stale unknown user detection ─────────────────────────────────────── */

/**
 * Returns user IDs that are marked "Unknown User" but haven't been retried
 * in STALE_UNKNOWN_RETRY_DAYS days. These should be included in the next
 * individual lookup batch to check if they've become resolvable.
 */
export async function getStaleUnknownUserIds(
  admin: any,
  tenantId: string,
): Promise<string[]> {
  const staleThreshold = new Date(
    Date.now() - STALE_UNKNOWN_RETRY_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data } = await admin
    .from("ghl_cache_users")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_name", UNKNOWN_USER)
    .lt("updated_at", staleThreshold);

  return (data ?? []).map((r: any) => r.user_id);
}
