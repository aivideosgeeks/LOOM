import type { IntegrationPlatform } from "@loom/shared";
import { PLATFORM_CAPABILITIES } from "@loom/shared";
import { jobs } from "../jobs/queue";
import { logger } from "../lib/logger";
import { Contact, Deal, LeadFormMapping, Message, User, WebhookEvent, type ContactDoc } from "../models";
import { createNote, touchActivity } from "../services/activity";

/**
 * The one path everything ingested takes, whatever platform it came from and
 * however it arrived.
 *
 * Both webhook deliveries and the polling fallback call in here, which is what
 * keeps "no duplicate contacts regardless of ingestion path" true by
 * construction rather than by remembering to check twice.
 *
 * The AI requirements in all three briefs are met by one decision: every piece
 * of inbound text becomes a Note. createNote already classifies sentiment,
 * embeds the text for semantic search, and re-scores the deal, so a DM or a
 * lead answer travels the same road as something typed by hand. Nothing here
 * scores, embeds or classifies anything itself.
 */

export interface InboundMessage {
  platform: IntegrationPlatform;
  externalMessageId: string;
  senderExternalId: string;
  senderName?: string | null;
  senderHandle?: string | null;
  email?: string | null;
  phone?: string | null;
  text: string;
  sentAt?: Date;
}

export interface InboundLead {
  platform: IntegrationPlatform;
  externalLeadId: string;
  formId: string;
  formName?: string | null;
  /** Raw answers keyed by the platform's own field names. */
  fields: Record<string, string>;
  createdAt?: Date;
}

export interface IngestOutcome {
  contactId: string;
  dealId: string | null;
  created: boolean;
}

/** New records need an owner; without a real assignment rule they go to an admin. */
async function defaultOwnerId(): Promise<string> {
  const admin = await User.findOne({ role: "admin" }).select("_id").sort({ createdAt: 1 }).lean();
  if (admin) return String(admin._id);
  const anyone = await User.findOne().select("_id").lean();
  if (!anyone) throw new Error("Cannot ingest: this CRM has no accounts yet.");
  return String(anyone._id);
}

/**
 * Finds the person this belongs to, in the order the briefs specify: the
 * platform identity first, then email or phone, and only then a new contact.
 *
 * Matching on the platform id first matters because it is the only exact
 * identifier available. Email is a fallback because a lead form supplies one
 * and a DM usually does not, so the same person arriving by both routes still
 * lands on a single record.
 */
async function resolveContact(input: {
  platform: IntegrationPlatform;
  externalId?: string | null;
  handle?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}): Promise<{ contact: ContactDoc; created: boolean }> {
  const { platform, externalId, handle, email, phone } = input;

  if (externalId) {
    const byRef = await Contact.findOne({
      mergedInto: null,
      externalRefs: { $elemMatch: { platform, externalId } },
    });
    if (byRef) return { contact: byRef, created: false };
  }

  const or: Record<string, unknown>[] = [];
  if (email) or.push({ email: email.toLowerCase() });
  if (phone) or.push({ phone });
  if (or.length > 0) {
    const byContactDetail = await Contact.findOne({ mergedInto: null, $or: or });
    if (byContactDetail) {
      // Remember the platform identity so the next message skips straight here.
      if (externalId) {
        await Contact.updateOne(
          { _id: byContactDetail._id, "externalRefs.externalId": { $ne: externalId } },
          { $push: { externalRefs: { platform, externalId, handle: handle ?? null } } },
        );
      }
      return { contact: byContactDetail, created: false };
    }
  }

  const contact = await Contact.create({
    name: input.name?.trim() || handle || "Unknown contact",
    email: email?.toLowerCase() ?? null,
    phone: phone ?? null,
    tags: [`source:${platform}`],
    owner: await defaultOwnerId(),
    externalRefs: externalId ? [{ platform, externalId, handle: handle ?? null }] : [],
  });

  // Straight into the CRM's own duplicate detection rather than a private check,
  // so a lead and a DM from the same person surface as a candidate pair.
  await jobs.dedupeContact(String(contact._id));
  return { contact, created: true };
}

/**
 * The deal an inbound event belongs to.
 *
 * An open deal within the window gets the activity; otherwise a new one starts
 * in Lead. Without the window every message would open a deal, and a week of
 * back-and-forth would read as a week of separate opportunities.
 */
const NEW_DEAL_WINDOW_DAYS = 30;

async function resolveDeal(contact: ContactDoc, platform: IntegrationPlatform, title: string) {
  const since = new Date(Date.now() - NEW_DEAL_WINDOW_DAYS * 86_400_000);
  const open = await Deal.findOne({
    contact: contact._id,
    stage: { $nin: ["Won", "Lost"] },
    updatedAt: { $gte: since },
  }).sort({ updatedAt: -1 });
  if (open) return { deal: open, created: false };

  const deal = await Deal.create({
    title,
    contact: contact._id,
    value: 0,
    stage: "Lead",
    owner: contact.owner,
    stageHistory: [{ stage: "Lead", enteredAt: new Date() }],
    lastActivityAt: new Date(),
  });
  return { deal, created: true };
}

/** Records an inbound or outbound message and puts its text through the AI pipeline. */
export async function ingestMessage(input: InboundMessage): Promise<IngestOutcome> {
  const { contact, created } = await resolveContact({
    platform: input.platform,
    externalId: input.senderExternalId,
    handle: input.senderHandle,
    name: input.senderName,
    email: input.email,
    phone: input.phone,
  });

  const label = PLATFORM_CAPABILITIES[input.platform].label;
  const { deal } = await resolveDeal(contact, input.platform, `${label} enquiry - ${contact.name}`);
  const sentAt = input.sentAt ?? new Date();

  // The note is what the AI pipeline sees; the message row is what the thread renders.
  const note = await createNote({
    kind: "note",
    content: input.text,
    dealId: String(deal._id),
    contactId: String(contact._id),
    ownerId: String(contact.owner),
  });

  await Message.create({
    platform: input.platform,
    contact: contact._id,
    deal: deal._id,
    direction: "in",
    text: input.text,
    externalId: input.externalMessageId,
    deliveryStatus: "delivered",
    sentAt,
    note: note._id,
  });

  await touchActivity(String(deal._id), String(contact._id), sentAt);
  return { contactId: String(contact._id), dealId: String(deal._id), created };
}

/**
 * Turns a lead form submission into a contact and a deal.
 *
 * Mapped answers land on Contact fields. Everything else goes into the note
 * body rather than being discarded, which is what "unmapped fields never
 * silently dropped" asks for, and it also means those answers are embedded and
 * sentiment-scored like any other text.
 */
export async function ingestLead(input: InboundLead): Promise<IngestOutcome> {
  const mapping = await LeadFormMapping.findOne({ platform: input.platform, formId: input.formId }).lean();
  const byKey = new Map((mapping?.fieldMappings ?? []).map((m) => [m.externalKey, m.crmField]));

  const mapped: Record<string, string> = {};
  const unmapped: Array<[string, string]> = [];

  for (const [key, value] of Object.entries(input.fields)) {
    if (!value?.trim()) continue;
    // With no saved mapping, fall back to the platform's conventional key names.
    const target = byKey.get(key) ?? guessField(key);
    if (target && target !== "note") mapped[target] = value.trim();
    else unmapped.push([key, value.trim()]);
  }

  const { contact, created } = await resolveContact({
    platform: input.platform,
    externalId: input.externalLeadId,
    name: mapped.name ?? mapped.full_name ?? null,
    email: mapped.email ?? null,
    phone: mapped.phone ?? null,
  });

  // Mapped values only fill blanks: a lead form should not overwrite something
  // someone has since corrected by hand.
  const fill: Record<string, string> = {};
  for (const field of ["name", "email", "phone", "company"] as const) {
    const value = mapped[field];
    if (value && !contact.get(field)) fill[field] = field === "email" ? value.toLowerCase() : value;
  }
  if (Object.keys(fill).length > 0) await Contact.updateOne({ _id: contact._id }, { $set: fill });

  const label = PLATFORM_CAPABILITIES[input.platform].label;
  const { deal } = await resolveDeal(contact, input.platform, `${label} lead - ${input.formName || input.formId}`);

  const lines = [
    `${label} lead form: ${input.formName || input.formId}`,
    ...Object.entries(mapped).map(([k, v]) => `${k}: ${v}`),
    ...unmapped.map(([k, v]) => `${k}: ${v}`),
  ];
  await createNote({
    kind: "note",
    content: lines.join("\n"),
    dealId: String(deal._id),
    contactId: String(contact._id),
    ownerId: String(contact.owner),
  });

  await touchActivity(String(deal._id), String(contact._id), input.createdAt ?? new Date());
  return { contactId: String(contact._id), dealId: String(deal._id), created };
}

/**
 * Best guess at a CRM field from a platform's field key.
 *
 * Meta uses stable snake_case keys for its standard questions, and TikTok's
 * form metadata is not reliably readable, so both benefit from a default that
 * works before anyone configures a mapping. Anything unrecognised returns null
 * and is kept as note text rather than guessed at.
 */
export function guessField(key: string): string | null {
  const k = key.toLowerCase().replace(/[^a-z]/g, "");
  if (k.includes("email")) return "email";
  if (k.includes("phone") || k.includes("mobile") || k.includes("tel")) return "phone";
  if (k.includes("company") || k.includes("organisation") || k.includes("organization") || k.includes("business")) return "company";
  if (k === "name" || k.includes("fullname") || k.includes("yourname")) return "name";
  return null;
}

/**
 * Processes one platform event exactly once.
 *
 * Both platforms retry on any non-2xx, and Meta resends after a timeout even
 * when the first attempt eventually succeeded. The unique index on
 * (platform, eventId) is what makes a redelivery a no-op: the insert fails, and
 * that failure is the answer rather than an error.
 */
export async function processOnce(
  meta: { platform: IntegrationPlatform; eventId: string; kind: "message" | "lead" | "comment"; source: "webhook" | "polling"; payload?: unknown },
  handler: () => Promise<IngestOutcome>,
): Promise<{ status: "processed" | "duplicate" | "failed"; contactId?: string; error?: string }> {
  let event;
  try {
    event = await WebhookEvent.create({
      platform: meta.platform,
      eventId: meta.eventId,
      kind: meta.kind,
      source: meta.source,
      payload: meta.payload ?? {},
      attempts: 1,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      logger.info({ platform: meta.platform, eventId: meta.eventId }, "Duplicate platform event ignored");
      return { status: "duplicate" };
    }
    throw err;
  }

  try {
    const outcome = await handler();
    event.status = "processed";
    event.contact = outcome.contactId as never;
    event.processedAt = new Date();
    await event.save();
    return { status: "processed", contactId: outcome.contactId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    event.status = "failed";
    event.error = message.slice(0, 500);
    await event.save();
    logger.error({ err, platform: meta.platform, eventId: meta.eventId }, "Failed to process platform event");
    return { status: "failed", error: message };
  }
}
