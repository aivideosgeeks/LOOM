import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";
import { NOTIFICATION_KINDS, type NotificationKind } from "@loom/shared";
import { logger } from "../lib/logger";
import { User } from "../models";
import { sendEmail } from "./email";
import { env } from "../config/env";

/**
 * In-app notifications.
 *
 * Everything the CRM decides on its own — a deal turning risky, a lead arriving
 * from a connected platform, a duplicate worth reviewing — happens in a
 * background job while nobody is looking at it. Without somewhere for those to
 * land, the only way to learn about them is to notice a number changed.
 *
 * Deliberately not a feed of everything. A notification is written only when
 * someone would want to act on it, because a list nobody trusts is a list
 * nobody reads.
 */
const notificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    kind: { type: String, enum: NOTIFICATION_KINDS, required: true },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    /** Where clicking it should go. */
    href: { type: String, default: null },
    readAt: { type: Date, default: null },
    /**
     * Collapses repeats. A deal that stays risky across three nightly scans
     * should not produce three identical rows.
     */
    dedupeKey: { type: String, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
notificationSchema.index({ user: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ user: 1, dedupeKey: 1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type NotificationDoc = HydratedDocument<InferSchemaType<typeof notificationSchema>>;
export const Notification = model("Notification", notificationSchema);

const TTL_MS = 60 * 86_400_000;
/** How long before the same thing may notify again. */
const REPEAT_AFTER_MS = 7 * 86_400_000;

export interface NotifyInput {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  href?: string;
  dedupeKey?: string;
  /** Also send an email. Used for the few things worth interrupting someone for. */
  email?: boolean;
}

/**
 * Records a notification, unless the same one was raised recently.
 *
 * Never throws. These are raised from background jobs, and a notification
 * failing must not fail the scoring or ingestion that produced it.
 */
export async function notify(input: NotifyInput): Promise<NotificationDoc | null> {
  try {
    if (input.dedupeKey) {
      const since = new Date(Date.now() - REPEAT_AFTER_MS);
      const existing = await Notification.findOne({ user: input.userId, dedupeKey: input.dedupeKey, createdAt: { $gte: since } });
      if (existing) return null;
    }

    const doc = await Notification.create({
      user: input.userId,
      kind: input.kind,
      title: input.title,
      body: input.body ?? "",
      href: input.href ?? null,
      dedupeKey: input.dedupeKey ?? null,
      expiresAt: new Date(Date.now() + TTL_MS),
    });

    if (input.email) void emailNotification(input).catch(() => undefined);
    return doc;
  } catch (err) {
    logger.warn({ err, kind: input.kind }, "Could not record notification");
    return null;
  }
}

async function emailNotification(input: NotifyInput) {
  const user = await User.findById(input.userId).select("email name").lean();
  if (!user?.email) return;
  const link = input.href ? `${env.WEB_ORIGIN.replace(/\/$/, "")}${input.href}` : env.WEB_ORIGIN;
  await sendEmail({
    to: user.email,
    subject: input.title,
    body: [input.body, "", link].filter(Boolean).join("\n"),
  });
}

/** Notifies several people at once, skipping anyone who caused the event themselves. */
export async function notifyMany(userIds: string[], input: Omit<NotifyInput, "userId">, exceptUserId?: string) {
  const unique = Array.from(new Set(userIds.filter((id) => id && id !== exceptUserId)));
  await Promise.all(unique.map((userId) => notify({ ...input, userId })));
}

export async function notifyAdmins(input: Omit<NotifyInput, "userId">, exceptUserId?: string) {
  const admins = await User.find({ role: "admin" }).select("_id").lean();
  await notifyMany(admins.map((a) => String(a._id)), input, exceptUserId);
}
