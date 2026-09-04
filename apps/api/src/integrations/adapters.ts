import { createHmac } from "node:crypto";
import type { IntegrationPlatform } from "@loom/shared";
import { env } from "../config/env";
import { signatureMatches } from "../lib/secretBox";
import type { InboundLead, InboundMessage } from "./ingest";

/**
 * What differs between platforms, and nothing else.
 *
 * Everything the three briefs share — OAuth storage, idempotency, contact
 * resolution, the AI pipeline, the sync log — lives outside this file. An
 * adapter only has to prove a request is genuine and describe what arrived in
 * the shared shape.
 */

export interface NormalizedEvent {
  eventId: string;
  kind: "message" | "lead" | "comment";
  message?: InboundMessage;
  lead?: InboundLead;
}

export interface PlatformAdapter {
  platform: IntegrationPlatform;
  /** Rejects a request that did not come from the platform. */
  verify(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean;
  /** Turns one delivery into zero or more events. A single Meta POST can carry many. */
  parse(body: unknown): NormalizedEvent[];
}

/**
 * Meta signs with HMAC-SHA256 over the raw body, as `sha256=<hex>`.
 *
 * The raw bytes matter: re-serialising the parsed JSON changes key order and
 * whitespace, and the signature stops matching. The route keeps the buffer for
 * exactly this reason.
 */
function verifyMeta(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean {
  const secret = env.META_APP_SECRET;
  // Without a secret configured, refuse rather than accept: an unverified
  // webhook is an open endpoint that writes to the CRM.
  if (!secret) return false;
  const header = headers["x-hub-signature-256"];
  const received = Array.isArray(header) ? header[0] : header;
  if (!received) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  return signatureMatches(expected, received);
}

/** One Meta messaging entry, in the shape the Graph API sends. */
interface MetaMessagingEntry {
  id?: string;
  time?: number;
  messaging?: Array<{
    sender?: { id?: string };
    recipient?: { id?: string };
    timestamp?: number;
    message?: { mid?: string; text?: string; is_echo?: boolean };
  }>;
  changes?: Array<{
    field?: string;
    value?: {
      leadgen_id?: string;
      form_id?: string;
      form_name?: string;
      created_time?: number;
      field_data?: Array<{ name?: string; values?: string[] }>;
      // Comments arrive with a different shape again.
      comment_id?: string;
      message?: string;
      from?: { id?: string; name?: string };
    };
  }>;
}

function parseMeta(platform: "instagram" | "facebook", body: unknown): NormalizedEvent[] {
  const payload = body as { entry?: MetaMessagingEntry[] };
  const events: NormalizedEvent[] = [];

  for (const entry of payload.entry ?? []) {
    for (const m of entry.messaging ?? []) {
      // Echoes are the page's own outbound messages coming back. Ingesting them
      // would file our replies as if the customer had sent them.
      if (m.message?.is_echo) continue;
      const text = m.message?.text?.trim();
      const senderId = m.sender?.id;
      if (!text || !senderId) continue;
      events.push({
        eventId: m.message?.mid ?? `${platform}:${senderId}:${m.timestamp ?? Date.now()}`,
        kind: "message",
        message: {
          platform,
          externalMessageId: m.message?.mid ?? `${senderId}:${m.timestamp ?? Date.now()}`,
          senderExternalId: senderId,
          text,
          sentAt: m.timestamp ? new Date(m.timestamp) : new Date(),
        },
      });
    }

    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};

      if (change.field === "leadgen" && v.leadgen_id) {
        // The webhook carries only the id; the full answers need a Graph call.
        // Recorded here so it is idempotent even before that call is made.
        events.push({
          eventId: `leadgen:${v.leadgen_id}`,
          kind: "lead",
          lead: {
            platform,
            externalLeadId: v.leadgen_id,
            formId: v.form_id ?? "unknown",
            formName: v.form_name ?? null,
            fields: Object.fromEntries((v.field_data ?? []).map((f) => [f.name ?? "", f.values?.[0] ?? ""])),
            createdAt: v.created_time ? new Date(v.created_time * 1000) : new Date(),
          },
        });
      }

      if (change.field === "comments" && v.comment_id && v.message?.trim()) {
        events.push({
          eventId: `comment:${v.comment_id}`,
          kind: "comment",
          message: {
            platform,
            externalMessageId: v.comment_id,
            senderExternalId: v.from?.id ?? v.comment_id,
            senderName: v.from?.name ?? null,
            text: v.message.trim(),
          },
        });
      }
    }
  }

  return events;
}

export const instagramAdapter: PlatformAdapter = {
  platform: "instagram",
  verify: verifyMeta,
  parse: (body) => parseMeta("instagram", body),
};

export const facebookAdapter: PlatformAdapter = {
  platform: "facebook",
  verify: verifyMeta,
  parse: (body) => parseMeta("facebook", body),
};

/**
 * TikTok signs as `t=<timestamp>, s=<hex>` over `timestamp.body`.
 *
 * Its webhook tier is not dependable, which is why the polling job exists and
 * is not treated as a fallback nobody maintains. Both paths produce the same
 * events and go through the same idempotency check, so a lead arriving twice by
 * two different routes still creates one contact.
 */
export const tiktokAdapter: PlatformAdapter = {
  platform: "tiktok",
  verify(rawBody, headers) {
    const secret = env.TIKTOK_APP_SECRET;
    if (!secret) return false;
    const header = headers["tiktok-signature"] ?? headers["x-tiktok-signature"];
    const received = Array.isArray(header) ? header[0] : header;
    if (!received) return false;

    const parts = Object.fromEntries(
      received.split(",").map((p) => {
        const [k, v] = p.trim().split("=");
        return [k, v ?? ""];
      }),
    );
    if (!parts.t || !parts.s) return false;
    const expected = createHmac("sha256", secret).update(`${parts.t}.${rawBody.toString("utf8")}`).digest("hex");
    return signatureMatches(expected, parts.s);
  },

  parse(body) {
    const payload = body as {
      event?: string;
      data?: { lead_id?: string; page_id?: string; form_id?: string; form_name?: string; create_time?: number; field_data?: Array<{ name?: string; values?: string[] }> };
    };
    const d = payload.data;
    if (!d?.lead_id) return [];
    return [
      {
        eventId: `tiktok-lead:${d.lead_id}`,
        kind: "lead",
        lead: {
          platform: "tiktok",
          externalLeadId: d.lead_id,
          formId: d.form_id ?? d.page_id ?? "unknown",
          formName: d.form_name ?? null,
          fields: Object.fromEntries((d.field_data ?? []).map((f) => [f.name ?? "", f.values?.[0] ?? ""])),
          createdAt: d.create_time ? new Date(d.create_time * 1000) : new Date(),
        },
      },
    ];
  },
};

export const ADAPTERS: Record<IntegrationPlatform, PlatformAdapter> = {
  instagram: instagramAdapter,
  facebook: facebookAdapter,
  tiktok: tiktokAdapter,
};
