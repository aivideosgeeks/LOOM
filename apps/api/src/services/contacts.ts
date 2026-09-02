import type { z } from "zod";
import type { contactCreateSchema, contactUpdateSchema } from "@loom/shared";
import type { AuthUser } from "../middleware/auth";
import { forbidden, notFound } from "../lib/errors";
import { jobs } from "../jobs/queue";
import { Contact, Deal, DuplicateCandidate, Meeting, Note, Task, type ContactDoc } from "../models";
import { removeNoteEmbedding } from "../ai/embeddings/semanticSearch";

type ContactCreate = z.infer<typeof contactCreateSchema>;
type ContactUpdate = z.infer<typeof contactUpdateSchema>;

const clean = (v: string | undefined | null) => (v === undefined ? undefined : v?.trim() ? v.trim() : null);

export async function createContact(input: ContactCreate, user: AuthUser): Promise<ContactDoc> {
  const owner = user.role === "admin" ? (input.owner ?? user.id) : user.id;
  const contact = await Contact.create({
    name: input.name,
    email: clean(input.email) ?? null,
    phone: clean(input.phone) ?? null,
    company: clean(input.company) ?? null,
    tags: input.tags ?? [],
    notes: clean(input.notes) ?? null,
    owner,
    lastActivityAt: new Date(),
  });
  await jobs.dedupeContact(String(contact._id));
  await jobs.scoreContact(String(contact._id));
  return contact;
}

export async function updateContact(contact: ContactDoc, input: ContactUpdate, user: AuthUser): Promise<ContactDoc> {
  if (user.role !== "admin" && String(contact.owner) !== user.id) throw forbidden("You can only edit your own contacts");
  if (input.name !== undefined) contact.name = input.name;
  if (input.email !== undefined) contact.email = clean(input.email) ?? null;
  if (input.phone !== undefined) contact.phone = clean(input.phone) ?? null;
  if (input.company !== undefined) contact.company = clean(input.company) ?? null;
  if (input.tags !== undefined) contact.tags = input.tags;
  if (input.notes !== undefined) contact.notes = clean(input.notes) ?? null;
  if (input.owner && user.role === "admin") contact.owner = input.owner as never;
  contact.lastActivityAt = new Date();
  await contact.save();
  await jobs.dedupeContact(String(contact._id));
  await jobs.scoreContact(String(contact._id));
  return contact;
}

export async function loadContactForUser(id: string, user: AuthUser): Promise<ContactDoc> {
  const contact = await Contact.findById(id);
  if (!contact || contact.mergedInto) throw notFound("Contact");
  if (user.role !== "admin" && String(contact.owner) !== user.id) throw notFound("Contact");
  return contact;
}

export async function deleteContact(contact: ContactDoc) {
  const notes = await Note.find({ contact: contact._id }).select("_id").lean();
  await Promise.all([
    Deal.deleteMany({ contact: contact._id }),
    Note.deleteMany({ contact: contact._id }),
    Task.deleteMany({ contact: contact._id }),
    Meeting.deleteMany({ contact: contact._id }),
    DuplicateCandidate.deleteMany({ $or: [{ a: contact._id }, { b: contact._id }] }),
  ]);
  for (const n of notes) await removeNoteEmbedding(String(n._id));
  await contact.deleteOne();
}
