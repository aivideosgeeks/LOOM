import { Router } from "express";
import { Types } from "mongoose";
import { contactCreateSchema, contactUpdateSchema, draftEmailRequestSchema, listQuerySchema, OPEN_STAGES, sendEmailSchema } from "@loom/shared";
import type { z } from "zod";
import { draftFollowUp } from "../ai/features/emailDraft";
import { escapeRegex } from "../ai/features/nlQuery";
import { isAdmin, ownerScope, requireAuth } from "../middleware/auth";
import { aiLimiter } from "../middleware/rateLimit";
import { idParam, parsedQuery, validateBody, validateQuery } from "../middleware/validate";
import { Contact, Deal, DuplicateCandidate, Note, Task } from "../models";
import { createNote } from "../services/activity";
import { createContact, deleteContact, loadContactForUser, updateContact } from "../services/contacts";
import { sendEmail } from "../services/email";
import { toContactDTO, toDealDTO, toNoteDTO, toTaskDTO } from "../services/serializers";

export const contactsRouter = Router();
contactsRouter.use(requireAuth);

const SORTABLE = new Set(["name", "company", "score", "lastActivityAt", "createdAt", "updatedAt"]);

contactsRouter.get("/", validateQuery(listQuerySchema), async (req, res) => {
  const q = parsedQuery<z.infer<typeof listQuerySchema>>(res);
  const filter: Record<string, unknown> = { ...ownerScope(req), mergedInto: null };
  if (q.q) {
    const re = new RegExp(escapeRegex(q.q), "i");
    filter.$or = [{ name: re }, { email: re }, { company: re }, { tags: re }];
  }
  if (q.owner && isAdmin(req)) filter.owner = q.owner;
  const sortField = q.sort && SORTABLE.has(q.sort) ? q.sort : "lastActivityAt";
  const sortDir = q.dir === "asc" ? 1 : -1;

  const [items, total] = await Promise.all([
    Contact.find(filter)
      .sort({ [sortField]: sortDir, _id: 1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate("owner", "name email role")
      .lean(),
    Contact.countDocuments(filter),
  ]);

  const ids = items.map((c) => c._id);
  const openDeals = await Deal.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { contact: { $in: ids }, stage: { $in: [...OPEN_STAGES] } } },
    { $group: { _id: "$contact", n: { $sum: 1 } } },
  ]);
  const openMap = new Map(openDeals.map((d) => [String(d._id), d.n]));

  res.json({
    items: items.map((c) => toContactDTO(c, { openDeals: openMap.get(String(c._id)) ?? 0 })),
    total,
    page: q.page,
    limit: q.limit,
  });
});

contactsRouter.post("/", validateBody(contactCreateSchema), async (req, res) => {
  const contact = await createContact(req.body, req.user!);
  await contact.populate("owner", "name email role");
  res.status(201).json({ contact: toContactDTO(contact) });
});

contactsRouter.get("/:id", async (req, res) => {
  const contact = await loadContactForUser(idParam(req), req.user!);
  await contact.populate("owner", "name email role");
  const [deals, notes, tasks, duplicates] = await Promise.all([
    Deal.find({ contact: contact._id }).sort({ updatedAt: -1 }).populate("contact", "name company email").populate("owner", "name email role").lean(),
    Note.find({ contact: contact._id }).sort({ createdAt: -1 }).limit(100).populate("author", "name email role").lean(),
    Task.find({ contact: contact._id }).sort({ done: 1, dueDate: 1 }).lean(),
    isAdmin(req) ? DuplicateCandidate.countDocuments({ status: "pending", $or: [{ a: contact._id }, { b: contact._id }] }) : Promise.resolve(0),
  ]);
  res.json({
    contact: toContactDTO(contact, { openDeals: deals.filter((d) => OPEN_STAGES.includes(d.stage)).length, duplicateCandidates: duplicates }),
    deals: deals.map(toDealDTO),
    notes: notes.map(toNoteDTO),
    tasks: tasks.map(toTaskDTO),
  });
});

contactsRouter.patch("/:id", validateBody(contactUpdateSchema), async (req, res) => {
  const contact = await loadContactForUser(idParam(req), req.user!);
  await updateContact(contact, req.body, req.user!);
  await contact.populate("owner", "name email role");
  res.json({ contact: toContactDTO(contact) });
});

contactsRouter.delete("/:id", async (req, res) => {
  const contact = await loadContactForUser(idParam(req), req.user!);
  await deleteContact(contact);
  res.json({ ok: true });
});

contactsRouter.post("/:id/draft-email", aiLimiter, validateBody(draftEmailRequestSchema), async (req, res) => {
  const contact = await loadContactForUser(idParam(req), req.user!);
  const draft = await draftFollowUp({ contact, deal: null, user: req.user!, intent: req.body.intent, tone: req.body.tone });
  res.json({ draft });
});

contactsRouter.post("/:id/emails", validateBody(sendEmailSchema), async (req, res) => {
  const contact = await loadContactForUser(idParam(req), req.user!);
  const result = await sendEmail(req.body);
  const note = await createNote({
    kind: "email",
    content: `To: ${req.body.to}\nSubject: ${req.body.subject}\n\n${req.body.body}`,
    contactId: String(contact._id),
    authorId: req.user!.id,
    ownerId: String(contact.owner),
  });
  res.status(201).json({ sent: result.sent, detail: result.detail, note: toNoteDTO(note) });
});
