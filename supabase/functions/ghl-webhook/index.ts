import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// GHL public key for webhook signature verification
const GHL_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAokvo/r9tVgcfZ5DysOSC
Frm602qYV0MaAiNnX9O8KxMbiyRKWeL9JpCpVpt4XHIcBOK4u3cLSqJGOLaPuXw6
dO0t6Q/ZVdAV5Phz+ZtzPL16iCGeK9po6D6JHBpbi989mmzMryUnQJezlYJ3DVfB
csedpinheNnyYeFXolrJvcsjDtfAeRx5ByHQmTnSdFUzuAnC9/GepgLT9SM4nCpv
uxmZMxrJt5Rw+VUaQ9B8JSvbMPpez4peKaJPZHBbU3OdeCVx5klVXXZQGNHOs8gF
3kvoV5rTnXV0IknLBXlcKKAQLZcY/Q9rG6Ifi9c+5vqlvHPCUJFT5XUGG5RKgOKU
J062fRtN+rLYZUV+BjafxQauvC8wSWeYja63VSUruvmNj8xkx2zE/Juc+yjLjTXp
IocmaiFeAO6fUtNjDeFVkhf5LNb59vECyrHD2SQIrhgXpO4Q3dVNA5rw576PwTzN
h/AMfHKIjE4xQA1SZuYJmNnmVZLIZBlQAF9Ntd03rfadZ+yDiOXCCs9FkHibELhC
HULgCsnuDJHcrGNd5/Ddm5hxGQ0ASitgHeMZ0kcIOwKDOzOU53lDza6/Y09T7sYJ
PQe7z0cvj7aE4B+Ax1ZoZGPzpJlZtGXCsu9aTEGEnKzmsFqwcSsnw3JB31IGKAyk
T1hhTiaCeIY/OwwwNUY2yvcCAwEAAQ==
-----END PUBLIC KEY-----`;

// Events we handle and the field mapping for each
const EVENT_USER_FIELD: Record<string, string> = {
  // Appointments
  AppointmentCreate: "assignedUserId",
  AppointmentUpdate: "assignedUserId",
  AppointmentDelete: "assignedUserId",
  // Contacts
  ContactCreate: "assignedTo",
  ContactUpdate: "assignedTo",
  ContactDelete: "assignedTo",
  ContactDndUpdate: "assignedTo",
  ContactTagUpdate: "assignedTo",
  // Conversations
  ConversationUnreadUpdate: "userId",
  // Messages (also covers calls)
  InboundMessage: "userId",
  OutboundMessage: "userId",
  // Tasks
  TaskCreate: "assignedTo",
  TaskComplete: "assignedTo",
  TaskDelete: "assignedTo",
  // Opportunities
  OpportunityCreate: "assignedTo",
  OpportunityUpdate: "assignedTo",
  OpportunityDelete: "assignedTo",
  OpportunityStatusUpdate: "assignedTo",
  OpportunityStageUpdate: "assignedTo",
  OpportunityMonetaryValueUpdate: "assignedTo",
  OpportunityAssignedToUpdate: "assignedTo",
  // Notes
  NoteCreate: "userId",
  NoteUpdate: "userId",
  NoteDelete: "userId",
  // Locations
  LocationCreate: "",
  LocationUpdate: "",
};

// Extract the contact ID from the payload (varies by event type)
function extractContactId(eventType: string, payload: any): string | null {
  // Appointments nest data under .appointment
  if (eventType.startsWith("Appointment")) {
    return payload.appointment?.contactId || null;
  }
  // Contacts have id at the top level
  if (eventType.startsWith("Contact")) {
    return payload.id || null;
  }
  // Messages, Tasks, Opportunities, Notes have contactId
  return payload.contactId || null;
}

// Extract the user ID (assignedTo / assignedUserId / userId)
function extractUserId(eventType: string, payload: any): string | null {
  const field = EVENT_USER_FIELD[eventType];
  if (!field) return null;

  // Appointments nest data under .appointment
  if (eventType.startsWith("Appointment")) {
    return payload.appointment?.[field] || null;
  }
  return payload[field] || null;
}

// Extract event date
function extractEventDate(eventType: string, payload: any): string {
  if (eventType.startsWith("Appointment")) {
    return (
      payload.appointment?.dateAdded ||
      payload.appointment?.dateUpdated ||
      new Date().toISOString()
    );
  }
  return payload.dateAdded || payload.dateUpdated || new Date().toISOString();
}

// Verify webhook signature using GHL public key
async function verifySignature(
  rawBody: string,
  signature: string,
): Promise<boolean> {
  try {
    // Import the PEM public key
    const pemContent = GHL_PUBLIC_KEY.replace(
      /-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\n/g,
      "",
    );
    const binaryKey = Uint8Array.from(atob(pemContent), (c) => c.charCodeAt(0));

    const cryptoKey = await crypto.subtle.importKey(
      "spki",
      binaryKey.buffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );

    const signatureBytes = Uint8Array.from(atob(signature), (c) =>
      c.charCodeAt(0),
    );
    const encoder = new TextEncoder();
    const data = encoder.encode(rawBody);

    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      signatureBytes,
      data,
    );
  } catch (e) {
    console.warn("Signature verification failed:", e);
    return false;
  }
}

/* ── main handler ────────────────────────────────────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Only accept POST
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const rawBody = await req.text();
    const payload = JSON.parse(rawBody);
    const eventType = payload.type;

    if (!eventType) {
      console.warn("Webhook received without type field");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ignore AppInstall events (not user activity)
    if (eventType === "AppInstall") {
      console.log("Ignoring AppInstall event");
      return new Response(JSON.stringify({ ok: true, ignored: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify signature (warn but don't reject — GHL may send without sig during testing)
    const signature = req.headers.get("x-wh-signature") || "";
    if (signature) {
      const valid = await verifySignature(rawBody, signature);
      if (!valid) {
        console.warn(`Invalid signature for ${eventType} webhook`);
        // Still process — some GHL environments don't sign correctly
      }
    }

    // Extract location_id
    const locationId = payload.locationId;
    if (!locationId) {
      console.warn(`Webhook ${eventType} missing locationId, skipping`);
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract fields
    const userId = extractUserId(eventType, payload);
    const contactId = extractContactId(eventType, payload);
    const eventDate = extractEventDate(eventType, payload);
    const webhookId = payload.webhookId || null;

    // Extract message type for channel breakdown (SMS/Call/Email)
    let messageType: string | null = null;
    if (eventType === "InboundMessage" || eventType === "OutboundMessage") {
      messageType = payload.messageType || null;
    }

    console.log(
      `Webhook: ${eventType} | location: ${locationId} | user: ${userId || "none"} | contact: ${contactId || "none"}`,
    );

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── 1. Insert raw event (7-day rolling buffer for ActivityFeed) ──
    const { error: insertErr } = await admin.from("ghl_events").insert({
      location_id: locationId,
      event_type: eventType,
      user_id: userId,
      contact_id: contactId,
      event_data: payload,
      event_date: eventDate,
      webhook_id: webhookId,
    });

    if (insertErr) {
      // Duplicate webhook_id → already processed, skip summary too
      if (insertErr.code === "23505") {
        console.log(`Duplicate webhook ${webhookId}, already processed`);
        return new Response(
          JSON.stringify({ ok: true, duplicate: true }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      console.error(`Raw insert error: ${insertErr.message}`);
      // Continue to summary upsert even if raw insert fails
    }

    // ── 2. Upsert daily summary for ALL tenants tracking this location ──
    const { data: locRows } = await admin
      .from("ghl_cache_locations")
      .select("tenant_id")
      .eq("location_id", locationId);

    if (!locRows || locRows.length === 0) {
      console.warn(`No tenant found for location ${locationId}, summary skipped`);
    } else {
      const eventDateObj = new Date(eventDate);
      const dateStr = eventDateObj.toISOString().slice(0, 10); // YYYY-MM-DD

      for (const locRow of locRows) {
        const { error: summaryErr } = await admin.rpc("upsert_event_summary", {
          p_tenant_id: locRow.tenant_id,
          p_location_id: locationId,
          p_event_date: dateStr,
          p_event_type: eventType,
          p_user_id: userId,
          p_message_type: messageType,
        });

        if (summaryErr) {
          console.error(`Summary upsert error for tenant ${locRow.tenant_id}: ${summaryErr.message}`);
        }
      }
    }

    return new Response(
      JSON.stringify({ ok: true, eventType, locationId }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error: any) {
    console.error("ghl-webhook error:", error.message);
    // Always return 200 to prevent GHL retry storms
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
