import { z } from "zod";
import type { MeetingResult } from "@loom/shared";
import { sha256 } from "../../lib/hash";
import { logger } from "../../lib/logger";
import { Contact, Deal, Meeting, Task } from "../../models";
import { createNote } from "../../services/activity";
import { jobs } from "../../jobs/queue";
import { callStructured } from "../gateway";
import { MEETING_SUMMARY_SYSTEM } from "../prompts";
import { sanitizeText, wrapData } from "../sanitize";
import { labelFor, lexiconSentiment } from "./sentiment";

export const meetingResultSchema = z.object({
  summary: z.string(),
  actionItems: z.array(
    z.object({
      title: z.string(),
      owner: z.string().nullable(),
      dueDate: z.string().nullable(),
    }),
  ),
  sentiment: z.object({
    score: z.number(),
    label: z.enum(["positive", "neutral", "negative"]),
    rationale: z.string(),
  }),
  nextSteps: z.array(z.string()),
  keyTopics: z.array(z.string()),
});

const DAY_MS = 86_400_000;
const MAX_TRANSCRIPT_CHARS = 150_000;

function normalizeDate(value: string | null): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Cheap extractive fallback so a transcript still yields something useful when the LLM is down. */
export function extractiveSummary(transcript: string): MeetingResult {
  const clean = sanitizeText(transcript, MAX_TRANSCRIPT_CHARS);
  // Drop header lines (Call:, Attendees:, Date:) and speaker labels before splitting into sentences.
  const body = clean
    .split("\n")
    .filter((line) => !/^\s*(call|meeting|attendees|participants|date|subject|title)\s*:/i.test(line))
    .map((line) => line.replace(/^\s*[A-Z][\w .'-]{0,40}:\s+/, ""))
    .join(" ");
  const sentences = body
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25);
  const summary = sentences.slice(0, 4).join(" ").slice(0, 900) || clean.slice(0, 400);
  // Only sentences that read like a commitment become action items.
  const actionRe = /\b(i|we|i'll|we'll|i will|we will|my team will|action item)\b[^.!?]*\b(send|schedule|set up|set that up|confirm|share|prepare|circulate|follow up|get back|review|reflect|book|arrange|deliver|provide)\b/i;
  const actionItems = sentences
    .filter((s) => actionRe.test(s))
    .slice(0, 6)
    .map((s) => ({ title: s.replace(/^[^a-zA-Z]+/, "").replace(/^(so|then|ok|okay|yes|perfect),?\s+/i, "").slice(0, 140), owner: null, dueDate: null }));
  const sentiment = lexiconSentiment(clean);
  return {
    summary,
    actionItems,
    sentiment,
    nextSteps: actionItems.slice(0, 3).map((a) => a.title),
    keyTopics: [],
  };
}

function coerceResult(data: z.infer<typeof meetingResultSchema>): MeetingResult {
  const score = Math.max(-1, Math.min(1, Number(data.sentiment.score) || 0));
  return {
    summary: sanitizeText(data.summary, 3000),
    actionItems: data.actionItems.slice(0, 20).map((a) => ({
      title: sanitizeText(a.title, 200),
      owner: a.owner ? sanitizeText(a.owner, 80) : null,
      dueDate: normalizeDate(a.dueDate),
    })).filter((a) => a.title.length > 0),
    sentiment: { score: Math.round(score * 100) / 100, label: labelFor(score), source: "ai", rationale: sanitizeText(data.sentiment.rationale, 300) },
    nextSteps: data.nextSteps.slice(0, 10).map((s) => sanitizeText(s, 200)).filter(Boolean),
    keyTopics: data.keyTopics.slice(0, 10).map((s) => sanitizeText(s, 40)).filter(Boolean),
  };
}

/** Background job: summarise a meeting, attach a note + tasks to the deal, feed sentiment into scoring. */
export async function summarizeMeeting(meetingId: string): Promise<void> {
  const meeting = await Meeting.findById(meetingId);
  if (!meeting || meeting.status === "done") return;
  meeting.status = "processing";
  await meeting.save();

  try {
    const deal = meeting.deal ? await Deal.findById(meeting.deal) : null;
    const contact = meeting.contact ? await Contact.findById(meeting.contact) : deal ? await Contact.findById(deal.contact) : null;
    const meetingDate = (meeting.createdAt ?? new Date()).toISOString().slice(0, 10);

    const user = [
      `Meeting date: ${meetingDate}`,
      deal ? wrapData("deal", `Title: ${deal.title}\nStage: ${deal.stage}\nValue: $${(deal.value ?? 0).toLocaleString("en-US")}`, { id: String(deal._id) }, 500) : "",
      contact ? wrapData("contact", `Name: ${contact.name}\nCompany: ${contact.company ?? "unknown"}`, { id: String(contact._id) }, 300) : "",
      wrapData("transcript", meeting.transcript, { title: meeting.title }, MAX_TRANSCRIPT_CHARS),
    ]
      .filter(Boolean)
      .join("\n\n");

    const result = await callStructured({
      feature: "meeting_summary",
      schema: meetingResultSchema,
      system: MEETING_SUMMARY_SYSTEM,
      user,
      effort: "medium",
      maxTokens: 16000,
      timeoutMs: 120_000,
      cache: { key: sha256({ t: meeting.transcript, d: meetingDate }), ttlMs: 30 * DAY_MS },
      userId: meeting.createdBy ? String(meeting.createdBy) : null,
      ref: { type: "meeting", id: String(meeting._id) },
    });

    let final: MeetingResult;
    if (result.ok) {
      final = coerceResult(result.data);
      meeting.source = "ai";
      meeting.error = null;
    } else {
      final = extractiveSummary(meeting.transcript);
      meeting.source = "fallback";
      meeting.error = `AI unavailable (${result.reason}); showing basic extraction.`;
    }

    meeting.result = final;
    meeting.status = "done";
    meeting.completedAt = new Date();
    await meeting.save();

    // Attach outcomes to the deal/contact timeline.
    const noteContent = [
      `Meeting summary: ${meeting.title}`,
      "",
      final.summary,
      final.nextSteps.length ? `\nNext steps:\n${final.nextSteps.map((s) => `- ${s}`).join("\n")}` : "",
      final.keyTopics.length ? `\nTopics: ${final.keyTopics.join(", ")}` : "",
    ]
      .join("\n")
      .trim();

    await createNote({
      kind: "meeting",
      content: noteContent,
      dealId: deal ? String(deal._id) : undefined,
      contactId: contact ? String(contact._id) : undefined,
      authorId: meeting.createdBy ? String(meeting.createdBy) : null,
      ownerId: String(meeting.owner),
      meetingId: String(meeting._id),
      sentiment: final.sentiment,
    });

    if (final.actionItems.length) {
      await Task.insertMany(
        final.actionItems.map((a) => ({
          title: a.owner ? `${a.title} (${a.owner})` : a.title,
          deal: deal ? deal._id : null,
          contact: contact ? contact._id : null,
          owner: meeting.owner,
          dueDate: a.dueDate ? new Date(a.dueDate) : null,
          source: "meeting",
          meeting: meeting._id,
        })),
      );
    }

    if (deal) {
      await jobs.scoreDeal(String(deal._id));
    }
    logger.info({ meetingId, source: meeting.source, actionItems: final.actionItems.length }, "Meeting summarised");
  } catch (error) {
    meeting.status = "failed";
    meeting.error = error instanceof Error ? error.message : String(error);
    await meeting.save();
    logger.error({ err: error, meetingId }, "Meeting summarisation failed");
  }
}
