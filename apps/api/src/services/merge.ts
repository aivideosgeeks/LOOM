import { badRequest, notFound } from "../lib/errors";
import { jobs } from "../jobs/queue";
import { Contact, Deal, DuplicateCandidate, Meeting, Note, NoteEmbedding, Task, type ContactDoc } from "../models";
import { logSystemNote } from "./activity";

/**
 * Admin-approved merge. The survivor keeps its data; empty fields are filled from the loser,
 * tags are unioned, and every deal / note / task / meeting / embedding is re-pointed. The loser
 * is soft-deleted via `mergedInto` so old links still resolve.
 */
export async function mergeContacts(candidateId: string, survivorId: string, userId: string): Promise<ContactDoc> {
  const candidate = await DuplicateCandidate.findById(candidateId);
  if (!candidate) throw notFound("Duplicate candidate");
  if (candidate.status !== "pending") throw badRequest("This candidate has already been resolved");

  const ids = [String(candidate.a), String(candidate.b)];
  if (!ids.includes(survivorId)) throw badRequest("survivorId must be one of the two candidate contacts");
  const loserId = ids.find((id) => id !== survivorId)!;

  const [survivor, loser] = await Promise.all([Contact.findById(survivorId), Contact.findById(loserId)]);
  if (!survivor || !loser) throw notFound("Contact");

  survivor.email = survivor.email ?? loser.email;
  survivor.phone = survivor.phone ?? loser.phone;
  survivor.company = survivor.company ?? loser.company;
  survivor.tags = [...new Set([...(survivor.tags ?? []), ...(loser.tags ?? [])])];
  if (loser.notes) survivor.notes = survivor.notes ? `${survivor.notes}\n\n[Merged from ${loser.name}]\n${loser.notes}` : loser.notes;
  survivor.lastActivityAt = new Date(Math.max(new Date(survivor.lastActivityAt ?? 0).getTime(), new Date(loser.lastActivityAt ?? 0).getTime()));
  await survivor.save();

  await Promise.all([
    Deal.updateMany({ contact: loser._id }, { $set: { contact: survivor._id } }),
    Note.updateMany({ contact: loser._id }, { $set: { contact: survivor._id } }),
    Task.updateMany({ contact: loser._id }, { $set: { contact: survivor._id } }),
    Meeting.updateMany({ contact: loser._id }, { $set: { contact: survivor._id } }),
    NoteEmbedding.updateMany({ contact: loser._id }, { $set: { contact: survivor._id } }),
  ]);

  loser.mergedInto = survivor._id;
  await loser.save();

  candidate.status = "merged";
  candidate.resolvedBy = userId as never;
  candidate.resolvedAt = new Date();
  await candidate.save();
  await DuplicateCandidate.updateMany(
    { _id: { $ne: candidate._id }, status: "pending", $or: [{ a: loser._id }, { b: loser._id }] },
    { $set: { status: "dismissed", resolvedBy: userId, resolvedAt: new Date() } },
  );

  await logSystemNote({ contactId: String(survivor._id), ownerId: String(survivor.owner), authorId: userId, content: `Merged duplicate contact "${loser.name}" (${loser.email ?? "no email"}) into this record` });
  await jobs.scoreContact(String(survivor._id));
  await jobs.dedupeContact(String(survivor._id));
  return survivor;
}

export async function dismissCandidate(candidateId: string, userId: string) {
  const candidate = await DuplicateCandidate.findById(candidateId);
  if (!candidate) throw notFound("Duplicate candidate");
  if (candidate.status !== "pending") throw badRequest("This candidate has already been resolved");
  candidate.status = "dismissed";
  candidate.resolvedBy = userId as never;
  candidate.resolvedAt = new Date();
  await candidate.save();
  return candidate;
}
