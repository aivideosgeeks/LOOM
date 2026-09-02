import { z } from "zod";
import { STAGE_STALL_THRESHOLD_DAYS, type EmailDraft, type EmailTone, type Stage } from "@loom/shared";
import { daysBetween } from "../../lib/dates";
import { sha256 } from "../../lib/hash";
import { Meeting, Note, Task, type ContactDoc, type DealDoc } from "../../models";
import type { AuthUser } from "../../middleware/auth";
import { callStructured } from "../gateway";
import { EMAIL_DRAFT_SYSTEM } from "../prompts";
import { sanitizeText, wrapData } from "../sanitize";

export const emailDraftSchema = z.object({
  subject: z.string(),
  body: z.string(),
  reasoning: z.string(),
});

export interface DraftParams {
  contact: ContactDoc;
  deal?: DealDoc | null;
  user: AuthUser;
  intent?: string;
  tone: EmailTone;
}

async function buildContext(p: DraftParams): Promise<string> {
  const parts: string[] = [];
  parts.push(
    wrapData("contact", `Name: ${p.contact.name}\nEmail: ${p.contact.email ?? "unknown"}\nCompany: ${p.contact.company ?? "unknown"}\nTags: ${(p.contact.tags ?? []).join(", ") || "none"}\nProfile notes: ${p.contact.notes ?? "none"}`, { id: String(p.contact._id) }, 1500),
  );
  if (p.deal) {
    const days = Math.round(daysBetween(p.deal.stageEnteredAt ?? p.deal.createdAt));
    parts.push(
      wrapData(
        "deal",
        `Title: ${p.deal.title}\nStage: ${p.deal.stage} (in stage for ${days} days)\nValue: $${(p.deal.value ?? 0).toLocaleString("en-US")}\nExpected close: ${p.deal.expectedCloseDate ? new Date(p.deal.expectedCloseDate).toISOString().slice(0, 10) : "not set"}\nLead score: ${p.deal.score ?? 0}/100`,
        { id: String(p.deal._id) },
        800,
      ),
    );
  }
  const noteFilter = p.deal ? { deal: p.deal._id } : { contact: p.contact._id };
  const notes = await Note.find(noteFilter).sort({ createdAt: -1 }).limit(8).lean();
  for (const n of notes.reverse()) {
    parts.push(
      wrapData("note", n.content, {
        kind: n.kind,
        date: n.createdAt ? new Date(n.createdAt).toISOString().slice(0, 10) : "",
        sentiment: n.sentiment ? n.sentiment.label : "",
      }, 1200),
    );
  }
  const taskFilter = p.deal ? { deal: p.deal._id, done: false } : { contact: p.contact._id, done: false };
  const tasks = await Task.find(taskFilter).sort({ dueDate: 1 }).limit(6).lean();
  if (tasks.length) {
    parts.push(wrapData("open_tasks", tasks.map((t) => `- ${t.title}${t.dueDate ? ` (due ${new Date(t.dueDate).toISOString().slice(0, 10)})` : ""}`).join("\n"), {}, 800));
  }
  if (p.deal) {
    const meeting = await Meeting.findOne({ deal: p.deal._id, status: "done" }).sort({ createdAt: -1 }).lean();
    if (meeting?.result?.summary) {
      parts.push(wrapData("latest_meeting_summary", `${meeting.result.summary}\nNext steps: ${(meeting.result.nextSteps ?? []).join("; ")}`, { date: meeting.createdAt ? new Date(meeting.createdAt).toISOString().slice(0, 10) : "" }, 1500));
    }
  }
  return parts.join("\n\n");
}

function templateDraft(p: DraftParams): EmailDraft {
  const first = p.contact.name.split(" ")[0] || p.contact.name;
  const stage = (p.deal?.stage ?? "Lead") as Stage;
  const title = p.deal?.title ?? "our conversation";
  const cta: Record<Stage, string> = {
    Lead: "Would you be open to a 20-minute call this week so I can learn more about your priorities?",
    Contacted: "Would it help if I sent over a short overview tailored to your team, or shall we book a quick call?",
    Proposal: "Do you have any questions on the proposal? I am happy to walk through it with you or your stakeholders.",
    Negotiation: "Is there anything outstanding on the terms that I can help resolve so we can move forward?",
    Won: "Is there anything you need from us as you get started?",
    Lost: "If circumstances change, I would be glad to pick things back up whenever the timing is right.",
  };
  const body = `Hi ${first},\n\nI wanted to follow up on ${title}${p.contact.company ? ` at ${p.contact.company}` : ""}.${p.intent ? `\n\n${sanitizeText(p.intent, 400)}` : ""}\n\n${cta[stage]}\n\nBest regards,\n${p.user.name}`;
  return { subject: `Following up on ${title}`, body, source: "template", reasoning: "AI drafting unavailable; generated from a stage-based template." };
}

/** Context-aware follow-up. Never sends anything; the caller shows an editable draft. */
export async function draftFollowUp(p: DraftParams): Promise<EmailDraft> {
  const context = await buildContext(p);
  const stalledDays = p.deal ? STAGE_STALL_THRESHOLD_DAYS[p.deal.stage as Stage] : null;
  const user = [
    `Salesperson (sender): ${sanitizeText(p.user.name, 80)}`,
    `Requested tone: ${p.tone}`,
    p.intent ? `Purpose of this email (from the salesperson): ${sanitizeText(p.intent, 400)}` : "Purpose: a natural follow-up that moves the deal forward.",
    stalledDays && p.deal ? `Stall threshold for stage ${p.deal.stage}: ${stalledDays} days.` : "",
    "",
    "Context:",
    context,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await callStructured({
    feature: "email_draft",
    schema: emailDraftSchema,
    system: EMAIL_DRAFT_SYSTEM,
    user,
    effort: "medium",
    maxTokens: 4096,
    timeoutMs: 60_000,
    cache: { key: sha256({ user, sender: p.user.id }), ttlMs: 5 * 60_000 },
    userId: p.user.id,
    ref: p.deal ? { type: "deal", id: String(p.deal._id) } : { type: "contact", id: String(p.contact._id) },
  });

  if (result.ok) {
    return {
      subject: sanitizeText(result.data.subject, 200).replace(/\n/g, " "),
      body: result.data.body.trim(),
      source: "ai",
      reasoning: sanitizeText(result.data.reasoning, 400),
    };
  }
  return templateDraft(p);
}
