import { ENGAGEMENT_KINDS, OPEN_STAGES, type NoteKind } from "@loom/shared";
import { scanAllContactsForDuplicates, findDuplicatesForContact } from "../ai/features/duplicates";
import { scoreContact, scoreDeal } from "../ai/features/leadScore";
import { summarizeMeeting } from "../ai/features/meetingSummary";
import { assessDealRisk, scanAllDealsForRisk } from "../ai/features/riskFlag";
import { analyzeSentiment } from "../ai/features/sentiment";
import { embedNote } from "../ai/embeddings/semanticSearch";
import { logger } from "../lib/logger";
import { Deal, Note } from "../models";
import type { JobEnvelope } from "./types";

/** Sentiment + embedding for a new note, then re-score the deal/contact it belongs to. */
async function enrichNote(noteId: string) {
  const note = await Note.findById(noteId);
  if (!note) return;
  if (!note.sentiment && ENGAGEMENT_KINDS.includes(note.kind as NoteKind)) {
    note.sentiment = await analyzeSentiment(note.content, {
      userId: note.author ? String(note.author) : null,
      ref: { type: "note", id: String(note._id) },
    });
    await note.save();
  }
  await embedNote(noteId);
  if (note.deal) {
    await scoreDeal(String(note.deal));
    await assessDealRisk(String(note.deal));
  } else if (note.contact) {
    await scoreContact(String(note.contact));
  }
}

async function rescoreAllOpenDeals() {
  const deals = await Deal.find({ stage: { $in: OPEN_STAGES } }).select("_id").lean();
  let updated = 0;
  for (const d of deals) {
    const score = await scoreDeal(String(d._id));
    if (score !== null) updated += 1;
  }
  logger.info({ deals: deals.length, updated }, "Rescore complete");
}

export async function handleJob(job: JobEnvelope): Promise<void> {
  switch (job.name) {
    case "deal.score": {
      await scoreDeal(job.data.dealId);
      await assessDealRisk(job.data.dealId);
      return;
    }
    case "contact.score":
      await scoreContact(job.data.contactId);
      return;
    case "note.enrich":
      await enrichNote(job.data.noteId);
      return;
    case "meeting.summarize":
      await summarizeMeeting(job.data.meetingId);
      return;
    case "contact.dedupe":
      await findDuplicatesForContact(job.data.contactId);
      return;
    case "dedupe.scanAll":
      await scanAllContactsForDuplicates();
      return;
    case "integration.poll":
      await (await import("../integrations/poll")).pollAllPlatforms();
      return;
    case "integration.retry":
      await (await import("../integrations/poll")).retryFailedEvents();
      return;
    case "risk.scan":
      await scanAllDealsForRisk();
      return;
    case "deal.risk":
      await assessDealRisk(job.data.dealId);
      return;
    case "score.scanAll":
      await rescoreAllOpenDeals();
      return;
    default: {
      const unhandled: never = job;
      logger.warn({ job: unhandled }, "Unknown job");
    }
  }
}
