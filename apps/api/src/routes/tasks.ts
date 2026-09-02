import { Router } from "express";
import { z } from "zod";
import { objectIdSchema, taskCreateSchema, taskUpdateSchema } from "@loom/shared";
import { badRequest, notFound } from "../lib/errors";
import { ownerScope, requireAuth } from "../middleware/auth";
import { idParam, parsedQuery, validateBody, validateQuery } from "../middleware/validate";
import { Task } from "../models";
import { loadContactForUser } from "../services/contacts";
import { loadDealForUser } from "../services/deals";
import { toTaskDTO } from "../services/serializers";

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

const tasksQuery = z.object({
  deal: objectIdSchema.optional(),
  contact: objectIdSchema.optional(),
  done: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

tasksRouter.get("/", validateQuery(tasksQuery), async (req, res) => {
  const q = parsedQuery<z.infer<typeof tasksQuery>>(res);
  const filter: Record<string, unknown> = { ...ownerScope(req) };
  if (q.deal) filter.deal = q.deal;
  if (q.contact) filter.contact = q.contact;
  if (q.done) filter.done = q.done === "true";
  const tasks = await Task.find(filter).sort({ done: 1, dueDate: 1, createdAt: -1 }).limit(q.limit).lean();
  res.json({ tasks: tasks.map(toTaskDTO) });
});

tasksRouter.post("/", validateBody(taskCreateSchema), async (req, res) => {
  if (!req.body.deal && !req.body.contact) throw badRequest("A task needs a deal or a contact");
  let ownerId: string;
  let contactId = req.body.contact;
  if (req.body.deal) {
    const deal = await loadDealForUser(req.body.deal, req.user!);
    ownerId = String(deal.owner);
    contactId = contactId ?? String(deal.contact);
  } else {
    const contact = await loadContactForUser(req.body.contact!, req.user!);
    ownerId = String(contact.owner);
  }
  const task = await Task.create({
    title: req.body.title,
    deal: req.body.deal ?? null,
    contact: contactId ?? null,
    owner: ownerId,
    dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
    source: "manual",
  });
  res.status(201).json({ task: toTaskDTO(task) });
});

tasksRouter.patch("/:id", validateBody(taskUpdateSchema), async (req, res) => {
  const task = await Task.findOne({ _id: idParam(req), ...ownerScope(req) });
  if (!task) throw notFound("Task");
  if (req.body.title !== undefined) task.title = req.body.title;
  if (req.body.done !== undefined) task.done = req.body.done;
  if (req.body.dueDate !== undefined) task.dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;
  await task.save();
  res.json({ task: toTaskDTO(task) });
});

tasksRouter.delete("/:id", async (req, res) => {
  const task = await Task.findOne({ _id: idParam(req), ...ownerScope(req) });
  if (!task) throw notFound("Task");
  await task.deleteOne();
  res.json({ ok: true });
});
