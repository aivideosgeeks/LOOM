import { Router, type Request } from "express";
import { z } from "zod";
import { INTEGRATION_PLATFORMS, type IntegrationDTO, type IntegrationPlatform } from "@loom/shared";
import { badRequest, notFound } from "../lib/errors";
import { fingerprint, open, seal } from "../lib/secretBox";
import { requireRole } from "../middleware/auth";
import { idParam, validateBody } from "../middleware/validate";
import { Contact, Integration, Message, WebhookEvent, type IntegrationDoc } from "../models";
import { createNote, touchActivity } from "../services/activity";
import { loadContactForUser } from "../services/contacts";
import { sendPlatformMessage } from "../integrations/send";

export const integrationsRouter = Router();

function platformOf(req: Request, key = "platform"): IntegrationPlatform {
  const raw = idParam(req, key);
  if (!(INTEGRATION_PLATFORMS as readonly string[]).includes(raw)) throw badRequest(`Unknown platform: ${raw}`);
  return raw as IntegrationPlatform;
}

/** Tokens never leave the server. The fingerprint is enough to tell which one is stored. */
function toDTO(doc: IntegrationDoc): IntegrationDTO {
  const token = open(doc.accessToken);
  return {
    platform: doc.platform as IntegrationPlatform,
    status: doc.status as IntegrationDTO["status"],
    externalId: doc.externalId ?? null,
    externalName: doc.externalName ?? null,
    tokenFingerprint: token ? fingerprint(token) : null,
    expiresAt: doc.expiresAt ? doc.expiresAt.toISOString() : null,
    webhookActive: doc.webhookActive,
    lastPolledAt: doc.lastPolledAt ? doc.lastPolledAt.toISOString() : null,
    lastError: doc.lastError ?? null,
    connectedAt: doc.createdAt.toISOString(),
  };
}

/**
 * Connecting is admin-only and lists every platform, connected or not, so the
 * settings screen can show what is available rather than only what is on.
 */
integrationsRouter.get("/", requireRole("admin"), async (_req, res) => {
  const rows = await Integration.find().sort({ platform: 1 });
  res.json({ integrations: rows.map(toDTO) });
});

const connectSchema = z.object({
  accessToken: z.string().trim().min(10).max(4000),
  refreshToken: z.string().trim().max(4000).optional(),
  externalId: z.string().trim().max(200).optional(),
  externalName: z.string().trim().max(200).optional(),
  expiresAt: z.string().datetime().optional(),
});

/**
 * Stores a connection.
 *
 * The OAuth redirect dance needs a reviewed app on each platform, which is not
 * something the CRM can stand in for. This accepts a token directly so the rest
 * of the pipeline is usable and testable now; the callback route can hand its
 * result to exactly this code once an app is approved.
 */
integrationsRouter.post("/:platform/connect", requireRole("admin"), validateBody(connectSchema), async (req, res) => {
  const platform = platformOf(req);
  const doc = await Integration.findOneAndUpdate(
    { platform },
    {
      $set: {
        platform,
        accessToken: seal(req.body.accessToken),
        refreshToken: req.body.refreshToken ? seal(req.body.refreshToken) : null,
        externalId: req.body.externalId ?? null,
        externalName: req.body.externalName ?? null,
        expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null,
        status: "connected",
        lastError: null,
        connectedBy: req.user!.id,
      },
    },
    { new: true, upsert: true },
  );
  res.status(201).json({ integration: toDTO(doc) });
});

integrationsRouter.delete("/:platform", requireRole("admin"), async (req, res) => {
  const platform = platformOf(req);
  const doc = await Integration.findOne({ platform });
  if (!doc) throw notFound("Integration");
  // Deleted rather than flagged: leaving a dead token encrypted at rest serves
  // nobody, and reconnecting writes a fresh row anyway.
  await doc.deleteOne();
  res.json({ ok: true });
});

/**
 * The sync log.
 *
 * Split by source because the TikTok brief needs to show whether webhooks are
 * actually delivering or the polling fallback is quietly carrying everything.
 */
integrationsRouter.get("/sync-log", requireRole("admin"), async (req, res) => {
  const platform = req.query.platform ? platformOf(req as Request, "platform") : null;
  const filter = platform ? { platform } : {};

  const [rows, grouped] = await Promise.all([
    WebhookEvent.find(filter).sort({ createdAt: -1 }).limit(100).lean(),
    WebhookEvent.aggregate([
      ...(platform ? [{ $match: { platform } }] : []),
      {
        $group: {
          _id: "$platform",
          processed: { $sum: { $cond: [{ $eq: ["$status", "processed"] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
          skipped: { $sum: { $cond: [{ $eq: ["$status", "skipped"] }, 1, 0] } },
          viaWebhook: { $sum: { $cond: [{ $eq: ["$source", "webhook"] }, 1, 0] } },
          viaPolling: { $sum: { $cond: [{ $eq: ["$source", "polling"] }, 1, 0] } },
          lastEventAt: { $max: "$createdAt" },
        },
      },
    ]),
  ]);

  res.json({
    summary: grouped.map((g) => ({
      platform: g._id,
      processed: g.processed,
      failed: g.failed,
      skipped: g.skipped,
      viaWebhook: g.viaWebhook,
      viaPolling: g.viaPolling,
      lastEventAt: g.lastEventAt ? new Date(g.lastEventAt).toISOString() : null,
    })),
    events: rows.map((r) => ({
      id: String(r._id),
      platform: r.platform,
      kind: r.kind,
      source: r.source,
      status: r.status,
      error: r.error ?? null,
      contactId: r.contact ? String(r.contact) : null,
      attempts: r.attempts,
      createdAt: (r.createdAt as Date).toISOString(),
      processedAt: r.processedAt ? (r.processedAt as Date).toISOString() : null,
    })),
  });
});

/** The conversation on a contact, ordered oldest first so it reads as a thread. */
integrationsRouter.get("/messages/:id", async (req, res) => {
  const contact = await loadContactForUser(idParam(req), req.user!);
  const rows = await Message.find({ contact: contact._id }).sort({ sentAt: 1 }).limit(200).populate("sentBy", "name").lean();
  res.json({
    messages: rows.map((m) => ({
      id: String(m._id),
      platform: m.platform,
      direction: m.direction,
      text: m.text,
      deliveryStatus: m.deliveryStatus,
      deliveryError: m.deliveryError ?? null,
      sentAt: (m.sentAt as Date).toISOString(),
      sentBy: m.sentBy ? { id: String((m.sentBy as unknown as { _id: unknown })._id), name: (m.sentBy as unknown as { name: string }).name } : null,
    })),
  });
});

const sendSchema = z.object({
  platform: z.enum(INTEGRATION_PLATFORMS),
  text: z.string().trim().min(1).max(2000),
});

/**
 * Replies to a contact on the platform they wrote from.
 *
 * The row is written before the send is attempted and updated with the result,
 * so a failed delivery is visible in the thread rather than vanishing. The text
 * also becomes a note, which keeps outbound replies inside the same activity
 * timeline and lead-score signal as everything else.
 */
integrationsRouter.post("/messages/:id", validateBody(sendSchema), async (req, res) => {
  const contact = await loadContactForUser(idParam(req), req.user!);
  const platform = req.body.platform as IntegrationPlatform;

  const ref = (contact.externalRefs ?? []).find((r) => r.platform === platform);
  if (!ref) throw badRequest(`This contact has no ${platform} conversation to reply to.`);

  const message = await Message.create({
    platform,
    contact: contact._id,
    direction: "out",
    text: req.body.text,
    sentBy: req.user!.id,
    deliveryStatus: "pending",
  });

  const result = await sendPlatformMessage(platform, ref.externalId, req.body.text);
  message.deliveryStatus = result.ok ? "sent" : "failed";
  message.deliveryError = result.ok ? null : result.error;
  message.externalId = result.ok ? result.externalId : null;

  if (result.ok) {
    const note = await createNote({
      kind: "note",
      content: req.body.text,
      contactId: String(contact._id),
      ownerId: String(contact.owner),
      authorId: req.user!.id,
    });
    message.note = note._id;
    await touchActivity(null, String(contact._id));
  }
  await message.save();

  // 201 even when the platform refused it. The request did what it was asked:
  // the message was recorded and an attempt was made. Whether it reached the
  // recipient is data on the message, not the outcome of this call, and
  // returning an error status would leave the client reading a status line
  // ("Bad Gateway") instead of the reason.
  res.status(201).json({
    message: {
      id: String(message._id),
      platform,
      direction: "out",
      text: message.text,
      deliveryStatus: message.deliveryStatus,
      deliveryError: message.deliveryError,
      sentAt: (message.sentAt as Date).toISOString(),
      sentBy: { id: req.user!.id, name: req.user!.name },
    },
  });
});

/** Which contacts have a conversation, for the platform badges on the contact list. */
integrationsRouter.get("/threads", async (req, res) => {
  const scope = req.user!.role === "admin" ? {} : { owner: req.user!.id };
  const contactIds = await Contact.find(scope).select("_id").lean();
  const rows = await Message.aggregate([
    { $match: { contact: { $in: contactIds.map((c) => c._id) } } },
    { $group: { _id: { contact: "$contact", platform: "$platform" }, count: { $sum: 1 }, lastAt: { $max: "$sentAt" } } },
  ]);
  res.json({
    threads: rows.map((r) => ({
      contactId: String(r._id.contact),
      platform: r._id.platform,
      count: r.count,
      lastAt: new Date(r.lastAt).toISOString(),
    })),
  });
});
