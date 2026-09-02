import { Router } from "express";
import { dealCreateSchema, dealUpdateSchema, draftEmailRequestSchema, listQuerySchema, meetingCreateSchema, sendEmailSchema } from "@loom/shared";
import type { z } from "zod";
import { draftFollowUp } from "../ai/features/emailDraft";
import { scoreDeal } from "../ai/features/leadScore";
import { escapeRegex } from "../ai/features/nlQuery";
import { assessDealRisk } from "../ai/features/riskFlag";
import { isAdmin, ownerScope, requireAuth } from "../middleware/auth";
import { aiLimiter } from "../middleware/rateLimit";
import { idParam, parsedQuery, validateBody, validateQuery } from "../middleware/validate";
import { jobs } from "../jobs/queue";
import { Contact, Deal, Meeting, Note, Task } from "../models";
import { createNote } from "../services/activity";
import { createDeal, deleteDeal, loadDealForUser, updateDeal } from "../services/deals";
import { sendEmail } from "../services/email";
import { toDealDTO, toMeetingDTO, toNoteDTO, toTaskDTO } from "../services/serializers";

export const dealsRouter = Router();
dealsRouter.use(requireAuth);

const SORTABLE = new Set(["title", "value", "stage", "score", "expectedCloseDate", "lastActivityAt", "createdAt", "updatedAt", "stageEnteredAt"]);

dealsRouter.get("/", validateQuery(listQuerySchema), async (req, res) => {
  const q = parsedQuery<z.infer<typeof listQuerySchema>>(res);
  const filter: Record<string, unknown> = { ...ownerScope(req) };
  if (q.stage) filter.stage = q.stage;
  if (q.atRisk === "true") filter["risk.atRisk"] = true;
  if (q.atRisk === "false") filter["risk.atRisk"] = { $ne: true };
  if (q.owner && isAdmin(req)) filter.owner = q.owner;
  if (q.q) {
    const re = new RegExp(escapeRegex(q.q), "i");
    const contacts = await Contact.find({ $or: [{ name: re }, { company: re }] }).select("_id").lean();
    filter.$or = [{ title: re }, { contact: { $in: contacts.map((c) => c._id) } }];
  }
  const sortField = q.sort && SORTABLE.has(q.sort) ? q.sort : "score";
  const sortDir = q.dir === "asc" ? 1 : -1;
  const [items, total] = await Promise.all([
    Deal.find(filter)
      .sort({ [sortField]: sortDir, _id: 1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate("contact", "name company email")
      .populate("owner", "name email role")
      .lean(),
    Deal.countDocuments(filter),
  ]);
  res.json({ items: items.map(toDealDTO), total, page: q.page, limit: q.limit });
});

dealsRouter.post("/", validateBody(dealCreateSchema), async (req, res) => {
  const deal = await createDeal(req.body, req.user!);
  await deal.populate([{ path: "contact", select: "name company email" }, { path: "owner", select: "name email role" }]);
  res.status(201).json({ deal: toDealDTO(deal) });
});

dealsRouter.get("/:id", async (req, res) => {
  const deal = await loadDealForUser(idParam(req), req.user!);
  await deal.populate([{ path: "contact", select: "name company email" }, { path: "owner", select: "name email role" }]);
  const [notes, tasks, meetings] = await Promise.all([
    Note.find({ deal: deal._id }).sort({ createdAt: -1 }).limit(200).populate("author", "name email role").lean(),
    Task.find({ deal: deal._id }).sort({ done: 1, dueDate: 1, createdAt: -1 }).lean(),
    Meeting.find({ deal: deal._id }).sort({ createdAt: -1 }).select("-transcript").lean(),
  ]);
  res.json({ deal: toDealDTO(deal), notes: notes.map(toNoteDTO), tasks: tasks.map(toTaskDTO), meetings: meetings.map(toMeetingDTO) });
});

dealsRouter.patch("/:id", validateBody(dealUpdateSchema), async (req, res) => {
  const deal = await loadDealForUser(idParam(req), req.user!);
  await updateDeal(deal, req.body, req.user!);
  await deal.populate([{ path: "contact", select: "name company email" }, { path: "owner", select: "name email role" }]);
  res.json({ deal: toDealDTO(deal) });
});

dealsRouter.delete("/:id", async (req, res) => {
  const deal = await loadDealForUser(idParam(req), req.user!);
  await deleteDeal(deal);
  res.json({ ok: true });
});

/** Manual recompute (no LLM involved): useful after bulk imports or to refresh recency. */
dealsRouter.post("/:id/rescore", async (req, res) => {
  const deal = await loadDealForUser(idParam(req), req.user!);
  await scoreDeal(String(deal._id), { force: true });
  await assessDealRisk(String(deal._id), { force: true });
  const fresh = await Deal.findById(deal._id).populate("contact", "name company email").populate("owner", "name email role").lean();
  res.json({ deal: toDealDTO(fresh!) });
});

dealsRouter.post("/:id/draft-email", aiLimiter, validateBody(draftEmailRequestSchema), async (req, res) => {
  const deal = await loadDealForUser(idParam(req), req.user!);
  const contact = await Contact.findById(deal.contact);
  if (!contact) throw Object.assign(new Error("Contact not found"), { status: 404 });
  const draft = await draftFollowUp({ contact, deal, user: req.user!, intent: req.body.intent, tone: req.body.tone });
  res.json({ draft });
});

dealsRouter.post("/:id/emails", validateBody(sendEmailSchema), async (req, res) => {
  const deal = await loadDealForUser(idParam(req), req.user!);
  const result = await sendEmail(req.body);
  const note = await createNote({
    kind: "email",
    content: `To: ${req.body.to}\nSubject: ${req.body.subject}\n\n${req.body.body}`,
    dealId: String(deal._id),
    contactId: String(deal.contact),
    authorId: req.user!.id,
    ownerId: String(deal.owner),
  });
  res.status(201).json({ sent: result.sent, detail: result.detail, note: toNoteDTO(note) });
});

dealsRouter.get("/:id/meetings", async (req, res) => {
  const deal = await loadDealForUser(idParam(req), req.user!);
  const meetings = await Meeting.find({ deal: deal._id }).sort({ createdAt: -1 }).select("-transcript").lean();
  res.json({ meetings: meetings.map(toMeetingDTO) });
});

/** Accepts a transcript and summarises it in the background (202 + poll GET /api/meetings/:id). */
dealsRouter.post("/:id/meetings", aiLimiter, validateBody(meetingCreateSchema), async (req, res) => {
  const deal = await loadDealForUser(idParam(req), req.user!);
  const meeting = await Meeting.create({
    title: req.body.title?.trim() || `Meeting ${new Date().toISOString().slice(0, 10)}`,
    deal: deal._id,
    contact: deal.contact,
    owner: deal.owner,
    createdBy: req.user!.id,
    transcript: req.body.transcript,
    status: "pending",
  });
  await jobs.summarizeMeeting(String(meeting._id));
  res.status(202).json({ meeting: toMeetingDTO(meeting) });
});
