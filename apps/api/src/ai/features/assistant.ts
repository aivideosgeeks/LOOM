import {
  assistantPlanLlmSchema,
  describeAction,
  PIPELINE_STAGES,
  resolveDateToken,
  validateAssistantPlan,
  type AssistantActionLlm,
  type AssistantReply,
  type AssistantStep,
  type ResolvedAction,
  type TargetRef,
} from "@loom/shared";
import type { AuthUser } from "../../middleware/auth";
import { Contact, Deal, Task } from "../../models";
import { createNote } from "../../services/activity";
import { loadContactForUser } from "../../services/contacts";
import { loadDealForUser, updateDeal } from "../../services/deals";
import { sha256 } from "../../lib/hash";
import { callStructured } from "../gateway";
import { sanitizeText, UNTRUSTED_DATA_RULES, wrapData } from "../sanitize";
import { escapeRegex } from "./nlQuery";
import { askCrm } from "./nlQuery";

/**
 * The assistant: turns a plain-English message into either an answer or a set of
 * proposed changes.
 *
 * It deliberately stops short of acting on its own. The model proposes, the
 * server checks the proposal against a fixed allowlist, resolves every named
 * record against what this user is allowed to touch, and hands the result back
 * for a human to confirm. Only then does anything change. That is the same
 * stance the rest of the app takes: never auto-merge a duplicate, never
 * auto-send an email.
 */

function buildSystem(today: string): string {
  return `You are the assistant inside a CRM. You either answer a question about the pipeline, or propose changes for the user to confirm. You never claim to have done something: everything you propose is reviewed by a human first.

Today is ${today}.

Decide the intent:
- "answer" when the message asks about existing records ("which deals are stalling?"). Propose no actions; the CRM answers these itself.
- "act" when the message asks for a change ("remind me to call Sarah on Friday", "move the Globex deal to Proposal").
- "unsupported" when it is neither, or asks for something outside the allowed changes. Put the reason in summary.

The only changes you may propose:
- create_task: a follow-up. Needs a title and either a deal or a contact.
- add_note: a note on a deal or a contact.
- move_deal: change one deal's pipeline stage. Stages: ${PIPELINE_STAGES.join(", ")}.
- complete_task: mark an existing task done.

Refer to records by the name the user used, in the "name" field. Never invent an
identifier; the server matches names to records itself. If the user is vague
about which record they mean, choose "unsupported" and ask which one.

Dates use these forms only: today, tomorrow, start_of_week, end_of_week,
end_of_month, an offset like +3d or +2w, or an ISO date like 2026-05-04.

summary is one sentence, in the user's own words, saying what will happen.

${UNTRUSTED_DATA_RULES}`;
}

/** A name matched more than one record, or none. Either way the user picks, not the model. */
type Resolution<T> = { ok: true; value: T } | { ok: false; message: string };

function scope(user: AuthUser): Record<string, unknown> {
  return user.role === "admin" ? {} : { owner: user.id };
}

/** Matches on an exact name first, falling back to a contains search. */
function nameFilter(field: string, name: string) {
  return { [field]: { $regex: escapeRegex(name), $options: "i" } };
}

async function resolveDeal(ref: TargetRef, user: AuthUser): Promise<Resolution<string>> {
  const found = await Deal.find({ ...scope(user), ...nameFilter("title", ref.name) })
    .select("title")
    .limit(6)
    .lean();
  if (found.length === 1) return { ok: true, value: String(found[0]!._id) };
  if (found.length === 0) return { ok: false, message: `No deal matching "${ref.name}".` };
  return {
    ok: false,
    message: `"${ref.name}" matches more than one deal: ${found.map((d) => d.title).join(", ")}. Which one?`,
  };
}

async function resolveContact(ref: TargetRef, user: AuthUser): Promise<Resolution<string>> {
  const found = await Contact.find({
    ...scope(user),
    $or: [nameFilter("name", ref.name), nameFilter("company", ref.name)],
  })
    .select("name company")
    .limit(6)
    .lean();
  if (found.length === 1) return { ok: true, value: String(found[0]!._id) };
  if (found.length === 0) return { ok: false, message: `No contact matching "${ref.name}".` };
  return {
    ok: false,
    message: `"${ref.name}" matches more than one contact: ${found.map((c) => c.name).join(", ")}. Which one?`,
  };
}

async function resolveTask(ref: TargetRef, user: AuthUser): Promise<Resolution<string>> {
  const found = await Task.find({ ...scope(user), done: false, ...nameFilter("title", ref.name) })
    .select("title")
    .limit(6)
    .lean();
  if (found.length === 1) return { ok: true, value: String(found[0]!._id) };
  if (found.length === 0) return { ok: false, message: `No open task matching "${ref.name}".` };
  return {
    ok: false,
    message: `"${ref.name}" matches more than one task: ${found.map((t) => t.title).join(", ")}. Which one?`,
  };
}

/**
 * Turns a proposed action into one addressed at real records.
 *
 * Resolution runs under the caller's scope, so a member naming a colleague's
 * deal gets "no deal matching", which is the same answer they would get from
 * any other endpoint.
 */
async function resolveAction(action: AssistantActionLlm, user: AuthUser): Promise<Resolution<ResolvedAction>> {
  switch (action.kind) {
    case "create_task":
    case "add_note": {
      let deal: string | null = null;
      let contact: string | null = null;
      if (action.deal) {
        const r = await resolveDeal(action.deal, user);
        if (!r.ok) return r;
        deal = r.value;
      }
      if (action.contact) {
        const r = await resolveContact(action.contact, user);
        if (!r.ok) return r;
        contact = r.value;
      }
      if (action.kind === "create_task") {
        const due = action.dueDate ? resolveDateToken(action.dueDate) : null;
        return {
          ok: true,
          value: {
            kind: "create_task",
            title: action.title,
            deal,
            contact,
            dueDate: due ? due.toISOString() : null,
          },
        };
      }
      return { ok: true, value: { kind: "add_note", content: action.content, deal, contact } };
    }
    case "move_deal": {
      const r = await resolveDeal(action.deal, user);
      if (!r.ok) return r;
      return { ok: true, value: { kind: "move_deal", deal: r.value, stage: action.stage } };
    }
    case "complete_task": {
      const r = await resolveTask(action.task, user);
      if (!r.ok) return r;
      return { ok: true, value: { kind: "complete_task", task: r.value } };
    }
  }
}

export async function runAssistant(message: string, user: AuthUser): Promise<AssistantReply> {
  const clean = sanitizeText(message, 1000);
  const today = new Date().toISOString().slice(0, 10);

  const result = await callStructured({
    feature: "assistant",
    schema: assistantPlanLlmSchema,
    system: buildSystem(today),
    user: wrapData("message", clean, { role: user.role }, 1000),
    effort: "low",
    maxTokens: 2048,
    timeoutMs: 45_000,
    // Not cached: the same sentence means something different once the records
    // it refers to have changed.
    userId: user.id,
  });

  if (!result.ok) {
    // Without a model, a question can still be answered by the rule-based
    // translator. A request to change something cannot, and says so.
    const ask = await askCrm(clean, user);
    if (ask.ok) return { kind: "answer", summary: ask.explanation, ask };
    return {
      kind: "refused",
      reason:
        result.reason === "not_configured"
          ? "The assistant needs an AI provider configured. Questions still work through the built-in rules."
          : `The assistant is temporarily unavailable (${result.reason}).`,
      details: [],
    };
  }

  const validation = validateAssistantPlan(result.data);
  if (!validation.ok) return { kind: "refused", reason: validation.reason, details: validation.details };

  const plan = validation.plan;
  if (plan.intent === "answer") {
    const ask = await askCrm(clean, user);
    if (ask.ok) return { kind: "answer", summary: ask.explanation, ask };
    return { kind: "refused", reason: ask.reason, details: ask.details };
  }

  const steps: AssistantStep[] = [];
  for (const action of plan.actions) {
    const resolved = await resolveAction(action, user);
    // One unresolvable name fails the whole plan. Applying half of a
    // multi-step request and reporting the rest as a problem would leave the
    // CRM in a state the user never asked for.
    if (!resolved.ok) return { kind: "refused", reason: resolved.message, details: [] };
    steps.push({ description: describeAction(action), action: resolved.value });
  }

  return { kind: "proposal", summary: plan.summary, steps };
}

export interface ExecutionResult {
  applied: string[];
}

/**
 * Carries out confirmed actions.
 *
 * Every record is re-loaded through the same ownership helpers the REST routes
 * use, so an id edited in transit fails here exactly as it would there. The
 * proposal is not trusted; only this check is.
 */
export async function executeActions(actions: ResolvedAction[], user: AuthUser): Promise<ExecutionResult> {
  const applied: string[] = [];

  for (const action of actions) {
    switch (action.kind) {
      case "create_task": {
        const { ownerId, contactId } = await ownerFor(action.deal, action.contact, user);
        const task = await Task.create({
          title: action.title,
          deal: action.deal,
          contact: contactId,
          owner: ownerId,
          dueDate: action.dueDate ? new Date(action.dueDate) : null,
          source: "assistant",
        });
        applied.push(`Added task "${task.title}"`);
        break;
      }
      case "add_note": {
        const { ownerId, contactId } = await ownerFor(action.deal, action.contact, user);
        await createNote({
          kind: "note",
          content: action.content,
          dealId: action.deal ?? undefined,
          contactId: contactId ?? undefined,
          authorId: user.id,
          ownerId,
        });
        applied.push("Added a note");
        break;
      }
      case "move_deal": {
        const deal = await loadDealForUser(action.deal, user);
        const before = deal.stage;
        await updateDeal(deal, { stage: action.stage }, user);
        applied.push(`Moved "${deal.title}" from ${before} to ${action.stage}`);
        break;
      }
      case "complete_task": {
        const task = await Task.findOne({ _id: action.task, ...scope(user) });
        if (!task) throw new Error("That task no longer exists.");
        task.done = true;
        await task.save();
        applied.push(`Marked "${task.title}" done`);
        break;
      }
    }
  }

  return { applied };
}

/** Ownership for a new task or note follows the record it hangs off, as the REST routes do. */
async function ownerFor(dealId: string | null, contactId: string | null, user: AuthUser) {
  if (dealId) {
    const deal = await loadDealForUser(dealId, user);
    return { ownerId: String(deal.owner), contactId: contactId ?? String(deal.contact) };
  }
  const contact = await loadContactForUser(contactId!, user);
  return { ownerId: String(contact.owner), contactId: String(contact._id) };
}

/** Stable id for an assistant exchange, used by the history list. */
export function exchangeId(message: string, at: Date): string {
  return sha256({ message, at: at.toISOString() }).slice(0, 24);
}
