import { Router } from "express";
import { z } from "zod";
import { noteCreateSchema, objectIdSchema, type NoteKind } from "@loom/shared";
import { badRequest, notFound } from "../lib/errors";
import { ownerScope, requireAuth } from "../middleware/auth";
import { idParam, parsedQuery, validateBody, validateQuery } from "../middleware/validate";
import { Note } from "../models";
import { createNote } from "../services/activity";
import { loadContactForUser } from "../services/contacts";
import { loadDealForUser } from "../services/deals";
import { toNoteDTO } from "../services/serializers";
import { removeNoteEmbedding } from "../ai/embeddings/semanticSearch";

export const notesRouter = Router();
notesRouter.use(requireAuth);

const notesQuery = z.object({
  deal: objectIdSchema.optional(),
  contact: objectIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

notesRouter.get("/", validateQuery(notesQuery), async (req, res) => {
  const q = parsedQuery<z.infer<typeof notesQuery>>(res);
  const filter: Record<string, unknown> = { ...ownerScope(req) };
  if (q.deal) filter.deal = q.deal;
  if (q.contact) filter.contact = q.contact;
  const notes = await Note.find(filter).sort({ createdAt: -1 }).limit(q.limit).populate("author", "name email role").lean();
  res.json({ notes: notes.map(toNoteDTO) });
});

notesRouter.post("/", validateBody(noteCreateSchema), async (req, res) => {
  if (!req.body.deal && !req.body.contact) throw badRequest("A note needs a deal or a contact");
  let ownerId: string;
  let contactId: string | undefined = req.body.contact;
  if (req.body.deal) {
    const deal = await loadDealForUser(req.body.deal, req.user!);
    ownerId = String(deal.owner);
    contactId = contactId ?? String(deal.contact);
  } else {
    const contact = await loadContactForUser(req.body.contact!, req.user!);
    ownerId = String(contact.owner);
  }
  const note = await createNote({
    kind: req.body.kind as NoteKind,
    content: req.body.content,
    dealId: req.body.deal,
    contactId,
    authorId: req.user!.id,
    ownerId,
  });
  await note.populate("author", "name email role");
  res.status(201).json({ note: toNoteDTO(note) });
});

notesRouter.delete("/:id", async (req, res) => {
  const note = await Note.findOne({ _id: idParam(req), ...ownerScope(req) });
  if (!note) throw notFound("Note");
  await note.deleteOne();
  await removeNoteEmbedding(String(note._id));
  res.json({ ok: true });
});
