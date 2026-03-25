import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * tracker-ingest Edge Function
 *
 * Receives tracker session data from the GHL tracker script (bundle-v3.js).
 * Enriches each row with IP-based geolocation via ipapi.co (free HTTPS, 1000/day).
 *
 * The tracker script sends client metadata (timezone, locale, screen, user_agent)
 * and this function adds geo data (country, region, city, lat, lon, timezone).
 */

interface GeoResult {
  geo_country: string | null;
  geo_region: string | null;
  geo_city: string | null;
  geo_lat: number | null;
  geo_lon: number | null;
  geo_timezone: string | null;
}

async function lookupGeo(ip: string): Promise<GeoResult> {
  const empty: GeoResult = {
    geo_country: null,
    geo_region: null,
    geo_city: null,
    geo_lat: null,
    geo_lon: null,
    geo_timezone: null,
  };

  // Skip private/localhost IPs (RFC 1918 + loopback + IPv6 ULA)
  if (!ip || ip === "127.0.0.1" || ip === "::1") {
    console.log(`Skipping geo lookup for loopback IP: ${ip}`);
    return empty;
  }

  // Check RFC 1918 private ranges precisely
  if (ip.startsWith("10.") || ip.startsWith("192.168.")) {
    console.log(`Skipping geo lookup for private IP: ${ip}`);
    return empty;
  }
  // 172.16.0.0 - 172.31.255.255 only (NOT all 172.x.x.x)
  if (ip.startsWith("172.")) {
    const second = parseInt(ip.split(".")[1], 10);
    if (second >= 16 && second <= 31) {
      console.log(`Skipping geo lookup for private IP: ${ip}`);
      return empty;
    }
  }
  // IPv6 unique local
  if (ip.startsWith("fc") || ip.startsWith("fd")) {
    console.log(`Skipping geo lookup for IPv6 ULA: ${ip}`);
    return empty;
  }

  // Try ipapi.co (HTTPS, free 1000/day)
  try {
    const res = await fetch(
      `https://ipapi.co/${ip}/json/`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (res.ok) {
      const data = await res.json();
      if (!data.error) {
        return {
          geo_country: data.country_name || null,
          geo_region: data.region || null,
          geo_city: data.city || null,
          geo_lat: data.latitude ?? null,
          geo_lon: data.longitude ?? null,
          geo_timezone: data.timezone || null,
        };
      }
      console.warn("ipapi.co returned error:", data.reason || data.error);
    }
  } catch (e) {
    console.warn("ipapi.co lookup failed:", e);
  }

  // Fallback: ip-api.com (HTTP only, 45/min)
  try {
    const res = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,country,regionName,city,lat,lon,timezone`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (res.ok) {
      const data = await res.json();
      if (data.status === "success") {
        return {
          geo_country: data.country || null,
          geo_region: data.regionName || null,
          geo_city: data.city || null,
          geo_lat: data.lat ?? null,
          geo_lon: data.lon ?? null,
          geo_timezone: data.timezone || null,
        };
      }
    }
  } catch (e) {
    console.warn("ip-api.com fallback failed:", e);
  }

  return empty;
}

function getClientIp(req: Request): string {
  // Supabase Edge Functions / Cloudflare set these headers
  const xff = req.headers.get("x-forwarded-for");
  const realIp = req.headers.get("x-real-ip");
  const cfIp = req.headers.get("cf-connecting-ip");

  // x-forwarded-for can be "client, proxy1, proxy2" — take the first
  const ip = cfIp || (xff ? xff.split(",")[0].trim() : null) || realIp || "";

  console.log(`IP headers — cf-connecting-ip: ${cfIp}, x-forwarded-for: ${xff}, x-real-ip: ${realIp} → resolved: ${ip}`);
  return ip;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.json();

    // Validate required fields
    const { user_id, location_id, page_path, started_at } = body;
    if (!user_id || !location_id || !page_path || !started_at) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Get client IP and do geo lookup
    const clientIp = getClientIp(req);
    const geo = await lookupGeo(clientIp);

    console.log(`Geo result for ${clientIp}: ${JSON.stringify(geo)}`);

    // Build the row
    const row = {
      user_id,
      location_id,
      page_path,
      started_at,
      ended_at: body.ended_at || started_at,
      duration_seconds: body.duration_seconds || 0,
      heartbeats: body.heartbeats || 0,
      details: body.details || {},
      // Client metadata from tracker script
      client_timezone: body.client_timezone || null,
      client_locale: body.client_locale || null,
      user_agent: body.user_agent || null,
      screen_width: body.screen_width || null,
      screen_height: body.screen_height || null,
      // Geo from IP lookup
      ...geo,
    };

    // Insert using service role (bypasses RLS, trigger fills tenant_id)
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error } = await admin.from("tracker_page_sessions").insert(row);

    if (error) {
      console.error("Insert error:", error.message);
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, geo_country: geo.geo_country, ip: clientIp }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error: any) {
    console.error("tracker-ingest error:", error.message);
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
