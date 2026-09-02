import type { NoteKind, Sentiment } from "@loom/shared";
import { detectInjection } from "../ai/sanitize";
import { sha256 } from "../lib/hash";
import { jobs } from "../jobs/queue";
import { Contact, Deal, Note, type NoteDoc } from "../models";

export interface CreateNoteParams {
  kind: NoteKind;
  content: string;
  dealId?: string | null;
  contactId?: string | null;
  authorId?: string | null;
  /** Owner of the record the note belongs to (drives member visibility). */
  ownerId: string;
  meetingId?: string | null;
  sentiment?: Sentiment | null;
}

export async function touchActivity(dealId?: string | null, contactId?: string | null, at: Date = new Date()) {
  if (dealId) await Deal.updateOne({ _id: dealId }, { $set: { lastActivityAt: at } });
  if (contactId) await Contact.updateOne({ _id: contactId }, { $set: { lastActivityAt: at } });
}

/**
 * Creates a timeline entry and triggers the AI side effects in the background:
 * sentiment classification, embedding for semantic search, and re-scoring.
 */
export async function createNote(p: CreateNoteParams): Promise<NoteDoc> {
  let contactId = p.contactId ?? null;
  if (p.dealId && !contactId) {
    const deal = await Deal.findById(p.dealId).select("contact").lean();
    contactId = deal ? String(deal.contact) : null;
  }
  const note = await Note.create({
    kind: p.kind,
    content: p.content,
    contentHash: sha256(p.content),
    deal: p.dealId ?? null,
    contact: contactId,
    author: p.authorId ?? null,
    owner: p.ownerId,
    meeting: p.meetingId ?? null,
    sentiment: p.sentiment ?? null,
    suspicious: detectInjection(p.content),
    embeddingStatus: p.kind === "system" ? "skipped" : "pending",
  });

  await touchActivity(p.dealId, contactId, note.createdAt ?? new Date());

  if (p.kind === "system") {
    if (p.dealId) await jobs.scoreDeal(p.dealId);
    else if (contactId) await jobs.scoreContact(contactId);
  } else {
    await jobs.enrichNote(String(note._id));
  }
  return note;
}

export async function logSystemNote(params: { dealId?: string | null; contactId?: string | null; ownerId: string; authorId?: string | null; content: string }) {
  return createNote({ kind: "system", content: params.content, dealId: params.dealId, contactId: params.contactId, ownerId: params.ownerId, authorId: params.authorId });
}
