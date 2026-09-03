import { env, isServerless, isTest } from "../config/env";
import { logger } from "../lib/logger";
import type { JobQueue } from "./types";

let queue: JobQueue | null = null;
let factory: (() => Promise<JobQueue>) | null = null;

/**
 * Lazily builds the queue: BullMQ when REDIS_URL is set, otherwise the in-memory queue.
 * The adapter is created asynchronously so BullMQ (and ioredis) are only loaded when needed.
 */
export async function getQueue(): Promise<JobQueue> {
  if (queue) return queue;
  if (factory) return factory();
  factory = async () => {
    if (queue) return queue;
    if (env.QUEUE_PROVIDER === "inline" || (env.QUEUE_PROVIDER === "auto" && isServerless && !env.REDIS_URL)) {
      // Serverless: nothing survives the response, so jobs run in-request.
      const { InlineQueue } = await import("./inlineQueue");
      queue = new InlineQueue();
      if (!isTest) logger.info("Job queue: inline (serverless; jobs run on the request path)");
    } else if (env.REDIS_URL) {
      const { BullQueue } = await import("./bullmqQueue");
      queue = new BullQueue(env.REDIS_URL);
      logger.info("Job queue: BullMQ (Redis)");
    } else {
      const { MemoryQueue } = await import("./memoryQueue");
      queue = new MemoryQueue(isTest ? 4 : 2);
      if (!isTest) logger.warn("REDIS_URL not set: using in-memory job queue (not durable). Set REDIS_URL for BullMQ.");
    }
    return queue;
  };
  return factory();
}

/** Test hook. */
export function setQueue(q: JobQueue | null) {
  queue = q;
  factory = null;
}

/** Small debounce so a burst of edits to the same record coalesces into one job. */
const DEBOUNCE_MS = isTest ? 0 : 1_500;

/** Typed helpers so the rest of the app never touches job names directly. */
export const jobs = {
  async scoreDeal(dealId: string) {
    await (await getQueue()).add("deal.score", { dealId }, { jobId: `deal.score:${dealId}`, delayMs: DEBOUNCE_MS });
  },
  async scoreContact(contactId: string) {
    await (await getQueue()).add("contact.score", { contactId }, { jobId: `contact.score:${contactId}`, delayMs: DEBOUNCE_MS });
  },
  async enrichNote(noteId: string) {
    await (await getQueue()).add("note.enrich", { noteId }, { jobId: `note.enrich:${noteId}` });
  },
  async summarizeMeeting(meetingId: string) {
    await (await getQueue()).add("meeting.summarize", { meetingId }, { jobId: `meeting.summarize:${meetingId}` });
  },
  async dedupeContact(contactId: string) {
    await (await getQueue()).add("contact.dedupe", { contactId }, { jobId: `contact.dedupe:${contactId}`, delayMs: DEBOUNCE_MS });
  },
  async assessDealRisk(dealId: string) {
    await (await getQueue()).add("deal.risk", { dealId }, { jobId: `deal.risk:${dealId}`, delayMs: DEBOUNCE_MS });
  },
  async scanRisk() {
    await (await getQueue()).add("risk.scan", {}, { jobId: `risk.scan:${Date.now()}` });
  },
  async scanDuplicates() {
    await (await getQueue()).add("dedupe.scanAll", {}, { jobId: `dedupe.scanAll:${Date.now()}` });
  },
  async rescoreAll() {
    await (await getQueue()).add("score.scanAll", {}, { jobId: `score.scanAll:${Date.now()}` });
  },
};
