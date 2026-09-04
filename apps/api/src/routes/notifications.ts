import { Router } from "express";
import { z } from "zod";
import type { NotificationDTO } from "@loom/shared";
import { requireAuth } from "../middleware/auth";
import { idParam, parsedQuery, validateQuery } from "../middleware/validate";
import { Notification } from "../services/notifications";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

const listQuery = z.object({
  unread: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/** Someone's own notifications. There is no route that reads another person's. */
notificationsRouter.get("/", validateQuery(listQuery), async (req, res) => {
  const { unread, limit } = parsedQuery<z.infer<typeof listQuery>>(res);
  const filter: Record<string, unknown> = { user: req.user!.id };
  if (unread === "true") filter.readAt = null;

  const [rows, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
    Notification.countDocuments({ user: req.user!.id, readAt: null }),
  ]);

  const items: NotificationDTO[] = rows.map((n) => ({
    id: String(n._id),
    kind: n.kind,
    title: n.title,
    body: n.body ?? "",
    href: n.href ?? null,
    readAt: n.readAt ? (n.readAt as Date).toISOString() : null,
    createdAt: (n.createdAt as Date).toISOString(),
  }));

  res.json({ items, unread: unreadCount });
});

notificationsRouter.post("/:id/read", async (req, res) => {
  await Notification.updateOne({ _id: idParam(req), user: req.user!.id }, { $set: { readAt: new Date() } });
  res.json({ ok: true });
});

notificationsRouter.post("/read-all", async (req, res) => {
  const result = await Notification.updateMany({ user: req.user!.id, readAt: null }, { $set: { readAt: new Date() } });
  res.json({ ok: true, marked: result.modifiedCount });
});
