import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";
import { INTEGRATION_PLATFORMS } from "@loom/shared";

/**
 * A connected third-party account.
 *
 * Tokens are stored sealed by lib/secretBox and are never returned by any API
 * route; the serializer exposes a fingerprint instead. One row per platform,
 * because none of the briefs cover managing several accounts on one platform
 * and pretending otherwise would invite half-working code.
 */
const integrationSchema = new Schema(
  {
    platform: { type: String, enum: INTEGRATION_PLATFORMS, required: true, unique: true },
    status: { type: String, enum: ["connected", "disconnected", "error"], default: "connected", index: true },

    /** Sealed. Never select this into anything that reaches a response. */
    accessToken: { type: String, required: true },
    refreshToken: { type: String, default: null },
    expiresAt: { type: Date, default: null },

    /** Page id, business account id, advertiser id — whatever the platform scopes calls to. */
    externalId: { type: String, default: null },
    externalName: { type: String, default: null },

    /** Verifies inbound webhook signatures. Sealed, like the token. */
    webhookSecret: { type: String, default: null },
    /** Whether a webhook subscription actually succeeded, which TikTok often refuses. */
    webhookActive: { type: Boolean, default: false },

    /** Where polling resumed from, for platforms where webhooks cannot be relied on. */
    lastPolledAt: { type: Date, default: null },

    lastError: { type: String, default: null },
    connectedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

export type IntegrationDoc = HydratedDocument<InferSchemaType<typeof integrationSchema>>;
export const Integration = model("Integration", integrationSchema);

/**
 * One inbound platform event, recorded before it is processed.
 *
 * This is what makes redelivery safe. Meta and TikTok both retry on any
 * non-2xx, and Meta will resend the same event after a timeout even if the
 * first attempt eventually succeeded. The unique index on (platform, eventId)
 * turns a duplicate into a no-op instead of a second contact.
 */
const webhookEventSchema = new Schema(
  {
    platform: { type: String, enum: INTEGRATION_PLATFORMS, required: true },
    eventId: { type: String, required: true },
    kind: { type: String, enum: ["message", "lead", "comment"], required: true },
    /** How it arrived, so the sync log can show whether polling is carrying the load. */
    source: { type: String, enum: ["webhook", "polling"], default: "webhook" },
    status: { type: String, enum: ["received", "processed", "failed", "skipped"], default: "received", index: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    error: { type: String, default: null },
    contact: { type: Schema.Types.ObjectId, ref: "Contact", default: null },
    processedAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false },
);
webhookEventSchema.index({ platform: 1, eventId: 1 }, { unique: true });
webhookEventSchema.index({ createdAt: -1 });

export type WebhookEventDoc = HydratedDocument<InferSchemaType<typeof webhookEventSchema>>;
export const WebhookEvent = model("WebhookEvent", webhookEventSchema);

/**
 * A message in a platform conversation.
 *
 * Stored alongside the Note that carries the same text, not instead of it. The
 * Note is what the AI pipeline works on, so sentiment, embeddings and lead
 * scoring apply to a DM exactly as they do to something typed by hand. This row
 * carries what a chat thread needs and a note does not: direction, delivery
 * state, and the platform's own id.
 */
const messageSchema = new Schema(
  {
    platform: { type: String, enum: INTEGRATION_PLATFORMS, required: true },
    contact: { type: Schema.Types.ObjectId, ref: "Contact", required: true, index: true },
    deal: { type: Schema.Types.ObjectId, ref: "Deal", default: null },
    direction: { type: String, enum: ["in", "out"], required: true },
    text: { type: String, required: true },
    externalId: { type: String, default: null },
    /** Set for outbound messages the user sent from the CRM. */
    sentBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    deliveryStatus: { type: String, enum: ["pending", "sent", "delivered", "failed"], default: "sent" },
    deliveryError: { type: String, default: null },
    sentAt: { type: Date, default: () => new Date() },
    /** The note this message produced, so deleting one can clean up the other. */
    note: { type: Schema.Types.ObjectId, ref: "Note", default: null },
  },
  { timestamps: true },
);
messageSchema.index({ contact: 1, sentAt: -1 });

export type MessageDoc = HydratedDocument<InferSchemaType<typeof messageSchema>>;
export const Message = model("Message", messageSchema);

/**
 * How one lead form's fields land on a Contact.
 *
 * Kept per form rather than per platform because two forms on the same page
 * routinely ask different questions. Anything not mapped is stored as a note
 * rather than dropped, which is what "unmapped fields never silently dropped"
 * requires.
 */
const leadFormMappingSchema = new Schema(
  {
    platform: { type: String, enum: INTEGRATION_PLATFORMS, required: true },
    formId: { type: String, required: true },
    formName: { type: String, default: "" },
    fieldMappings: {
      type: [
        {
          _id: false,
          externalKey: { type: String, required: true },
          /** A Contact field, or "note" to append it to the contact's timeline. */
          crmField: { type: String, required: true },
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);
leadFormMappingSchema.index({ platform: 1, formId: 1 }, { unique: true });

export type LeadFormMappingDoc = HydratedDocument<InferSchemaType<typeof leadFormMappingSchema>>;
export const LeadFormMapping = model("LeadFormMapping", leadFormMappingSchema);
