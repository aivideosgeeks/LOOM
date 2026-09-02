import type { z } from "zod";
import type { dealCreateSchema, dealUpdateSchema } from "@loom/shared";
import { assertCanAccess, type AuthUser } from "../middleware/auth";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { jobs } from "../jobs/queue";
import { Contact, Deal, Meeting, Note, Task, type DealDoc } from "../models";
import { removeNoteEmbedding } from "../ai/embeddings/semanticSearch";
import { logSystemNote } from "./activity";

type DealCreate = z.infer<typeof dealCreateSchema>;
type DealUpdate = z.infer<typeof dealUpdateSchema>;

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function createDeal(input: DealCreate, user: AuthUser): Promise<DealDoc> {
  const contact = await Contact.findById(input.contact);
  if (!contact || contact.mergedInto) throw badRequest("Contact not found");
  assertCanAccess({ user } as never, contact.owner);

  const owner = user.role === "admin" ? (input.owner ?? user.id) : user.id;
  const now = new Date();
  const deal = await Deal.create({
    title: input.title,
    contact: contact._id,
    value: input.value,
    stage: input.stage,
    owner,
    expectedCloseDate: parseDate(input.expectedCloseDate),
    stageEnteredAt: now,
    stageHistory: [{ stage: input.stage, enteredAt: now }],
    lastActivityAt: now,
  });
  await logSystemNote({ dealId: String(deal._id), contactId: String(contact._id), ownerId: owner, authorId: user.id, content: `Deal created in stage ${input.stage}` });
  await jobs.scoreDeal(String(deal._id));
  return deal;
}

export async function updateDeal(deal: DealDoc, input: DealUpdate, user: AuthUser): Promise<DealDoc> {
  if (user.role !== "admin" && String(deal.owner) !== user.id) throw forbidden("You can only edit your own deals");
  const changes: string[] = [];

  if (input.title !== undefined && input.title !== deal.title) {
    deal.title = input.title;
    changes.push("title");
  }
  if (input.value !== undefined && input.value !== deal.value) {
    changes.push(`value ${deal.value} → ${input.value}`);
    deal.value = input.value;
  }
  if (input.expectedCloseDate !== undefined) {
    deal.expectedCloseDate = parseDate(input.expectedCloseDate);
    changes.push("expected close date");
  }
  if (input.contact && String(deal.contact) !== input.contact) {
    const contact = await Contact.findById(input.contact);
    if (!contact || contact.mergedInto) throw badRequest("Contact not found");
    assertCanAccess({ user } as never, contact.owner);
    deal.contact = contact._id;
    changes.push("contact");
  }
  if (input.owner && user.role === "admin" && String(deal.owner) !== input.owner) {
    deal.owner = input.owner as never;
    changes.push("owner");
  }
  if (input.stage && input.stage !== deal.stage) {
    const from = deal.stage;
    const now = new Date();
    deal.stage = input.stage;
    deal.stageEnteredAt = now;
    deal.stageHistory.push({ stage: input.stage, enteredAt: now });
    await deal.save();
    await logSystemNote({ dealId: String(deal._id), contactId: String(deal.contact), ownerId: String(deal.owner), authorId: user.id, content: `Stage changed from ${from} to ${input.stage}` });
    changes.push("stage");
  }

  if (changes.length) {
    deal.lastActivityAt = new Date();
    await deal.save();
    await jobs.scoreDeal(String(deal._id));
  }
  return deal;
}

export async function loadDealForUser(id: string, user: AuthUser): Promise<DealDoc> {
  const deal = await Deal.findById(id);
  if (!deal) throw notFound("Deal");
  if (user.role !== "admin" && String(deal.owner) !== user.id) throw notFound("Deal");
  return deal;
}

export async function deleteDeal(deal: DealDoc) {
  const notes = await Note.find({ deal: deal._id }).select("_id").lean();
  await Promise.all([
    Note.deleteMany({ deal: deal._id }),
    Task.deleteMany({ deal: deal._id }),
    Meeting.deleteMany({ deal: deal._id }),
  ]);
  for (const n of notes) await removeNoteEmbedding(String(n._id));
  await deal.deleteOne();
}
