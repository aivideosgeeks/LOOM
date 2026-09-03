import {
  assistantPlanLlmSchema,
  describeAction,
  PIPELINE_STAGES,
  resolveDateToken,
  validateAssistantPlan,
  type AssistantActionLlm,
  type AssistantReply,
  type RecordRef,
  type TargetRef,
} from "@loom/shared";
import type { AuthUser } from "../../middleware/auth";
import { Contact, Deal, Note, Task } from "../../models";
import { createNote } from "../../services/activity";
import { createContact, loadContactForUser } from "../../services/contacts";
import { createDeal, loadDealForUser, updateDeal } from "../../services/deals";
import { toContactDTO, toDealDTO, toNoteDTO, toTaskDTO } from "../../services/serializers";
import { callStructured } from "../gateway";
import { sanitizeText, UNTRUSTED_DATA_RULES, wrapData } from "../sanitize";
import { askCrm, escapeRegex } from "./nlQuery";

/**
 * The assistant.
 *
 * It handles five kinds of message: a question about the data, a request to
 * change something, a request to see a record, a question about how to use the
 * CRM, and anything else.
 *
 * Changes are applied straight away rather than proposed for confirmation. That
 * is safe here only because of what the allowlist leaves out: nothing deletes,
 * merges, sends mail or changes anyone's role. Every action either creates a
 * record or moves one between states a person can move back. What was done is
 * always reported, with links to the records it touched.
 */

/**
 * What the assistant knows about the product itself, so "how do I invite
 * someone?" gets an accurate answer instead of a plausible-sounding one.
 * Anything not described here, it should decline rather than invent.
 */
const PRODUCT_GUIDE = `LOOM is a CRM. What it contains and how people use it:

Contacts: people and the companies they work for. Contacts page, "New contact".
  Each has a lead score with a breakdown you see by hovering the score dial.
Deals: opportunities attached to a contact, moving through stages
  ${PIPELINE_STAGES.join(" -> ")}. Deals page, "New deal". Open a deal to see its
  timeline, notes, tasks and risk flag. Drag or use the stage control to move it.
Notes: the timeline on a contact or deal. Sentiment is classified automatically
  and feeds the lead score.
Tasks: follow-ups attached to a deal or contact, with an optional due date.
  Tasks page, or the task box on a deal.
Meetings: paste a transcript on a deal and press Summarize; it produces a
  summary, action items that become tasks, sentiment, and next steps.
Ask your CRM: this assistant.
Semantic search: finds notes by meaning rather than keyword.
Duplicates (admin): likely duplicate contacts, reviewed and merged by hand. The
  CRM never merges automatically.
AI usage (admin): tokens, cost and latency for every AI call.
Team (admin): invite people by email. There is no public sign-up; an invite link
  is single-use and expires after seven days. Roles are admin and member.
  Admins see everything; members see only records they own.
Lead score: stage, recency, value, stage velocity, note sentiment and
  engagement, combined into 0-100. Won is 100, Lost is 0.
Risk flags: a deal stalls in a stage, goes quiet, turns negative in sentiment,
  or has a close date that no longer looks real.`;

function buildSystem(today: string, role: string): string {
  return `You are the assistant built into LOOM, a CRM. You act on the user's behalf and explain how the product works.

Today is ${today}. The person talking to you is a ${role}.

Choose one intent:
- "answer": they are asking about existing records ("which deals are stalling?", "contacts I haven't touched"). Return no actions; the CRM runs a validated query itself.
- "act": they are asking you to change something. Fill in actions.
- "show": they want to see one record ("open Sarah Chen", "tell me about the Globex deal"). Fill in lookup.
- "guide": they are asking how to do something in LOOM. Fill in guidance with short numbered steps, based only on the product description below.
- "unsupported": anything else, or a change outside the list. Explain why in summary.

Actions you may take:
- create_contact: name, and optionally email, phone, company, tags.
- create_deal: title and the contact it belongs to, optionally value, stage, expectedCloseDate.
- create_task: title, and either a deal or a contact, optionally dueDate.
- add_note: content, and either a deal or a contact.
- move_deal: a deal and its new stage. Stages: ${PIPELINE_STAGES.join(", ")}.
- complete_task: an existing open task.

You cannot delete anything, merge contacts, send email, or change roles. If
asked, use "unsupported" and say so plainly.

Refer to existing records by the name the user used, in a "name" field. Never
invent an identifier. If it is unclear which record they mean, use
"unsupported" and ask which one.

Dates: today, tomorrow, start_of_week, end_of_week, end_of_month, an offset like
+3d or +2w, or an ISO date like 2026-05-04. Nothing else.

summary is one sentence in the user's own terms, written as though the change is
already made when the intent is "act".

Product description:
${PRODUCT_GUIDE}

${UNTRUSTED_DATA_RULES}`;
}

type Resolution<T> = { ok: true; value: T } | { ok: false; message: string };

function scope(user: AuthUser): Record<string, unknown> {
  return user.role === "admin" ? {} : { owner: user.id };
}

function nameFilter(field: string, name: string) {
  return { [field]: { $regex: escapeRegex(name), $options: "i" } };
}

async function resolveDeal(ref: TargetRef, user: AuthUser): Promise<Resolution<string>> {
  const found = await Deal.find({ ...scope(user), ...nameFilter("title", ref.name) }).select("title").limit(6).lean();
  if (found.length === 1) return { ok: true, value: String(found[0]!._id) };
  if (found.length === 0) return { ok: false, message: `I could not find a deal matching "${ref.name}".` };
  return { ok: false, message: `"${ref.name}" matches several deals: ${found.map((d) => d.title).join(", ")}. Which one?` };
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
  if (found.length === 0) return { ok: false, message: `I could not find a contact matching "${ref.name}".` };
  return { ok: false, message: `"${ref.name}" matches several contacts: ${found.map((c) => c.name).join(", ")}. Which one?` };
}

async function resolveTask(ref: TargetRef, user: AuthUser): Promise<Resolution<string>> {
  const found = await Task.find({ ...scope(user), done: false, ...nameFilter("title", ref.name) })
    .select("title")
    .limit(6)
    .lean();
  if (found.length === 1) return { ok: true, value: String(found[0]!._id) };
  if (found.length === 0) return { ok: false, message: `I could not find an open task matching "${ref.name}".` };
  return { ok: false, message: `"${ref.name}" matches several tasks: ${found.map((t) => t.title).join(", ")}. Which one?` };
}

/** Ownership for something new follows the record it hangs off, as the REST routes do. */
async function ownerFor(dealId: string | null, contactId: string | null, user: AuthUser) {
  if (dealId) {
    const deal = await loadDealForUser(dealId, user);
    return { ownerId: String(deal.owner), contactId: contactId ?? String(deal.contact) };
  }
  const contact = await loadContactForUser(contactId!, user);
  return { ownerId: String(contact.owner), contactId: String(contact._id) };
}

/**
 * Carries out one action and describes what happened.
 *
 * Everything goes through the same services the REST routes use, so ownership,
 * stage history, scoring and activity timestamps behave identically whether a
 * person clicked a button or asked for it in words.
 */
async function runAction(
  action: AssistantActionLlm,
  user: AuthUser,
): Promise<Resolution<{ done: string; record?: RecordRef }>> {
  switch (action.kind) {
    case "create_contact": {
      const contact = await createContact(
        {
          name: action.name,
          email: action.email ?? undefined,
          phone: action.phone ?? undefined,
          company: action.company ?? undefined,
          tags: action.tags ?? undefined,
        },
        user,
      );
      return {
        ok: true,
        value: {
          done: `Added contact ${contact.name}`,
          record: { entity: "contact", id: String(contact._id), label: contact.name, sublabel: contact.company ?? undefined },
        },
      };
    }

    case "create_deal": {
      const contactId = await resolveContact(action.contact, user);
      if (!contactId.ok) return contactId;
      const close = action.expectedCloseDate ? resolveDateToken(action.expectedCloseDate) : null;
      const deal = await createDeal(
        {
          title: action.title,
          contact: contactId.value,
          value: action.value ?? 0,
          stage: action.stage ?? "Lead",
          expectedCloseDate: close ? close.toISOString() : undefined,
        },
        user,
      );
      return {
        ok: true,
        value: {
          done: `Created deal "${deal.title}"`,
          record: { entity: "deal", id: String(deal._id), label: deal.title, sublabel: deal.stage },
        },
      };
    }

    case "create_task": {
      let dealId: string | null = null;
      let contactId: string | null = null;
      if (action.deal) {
        const r = await resolveDeal(action.deal, user);
        if (!r.ok) return r;
        dealId = r.value;
      }
      if (action.contact) {
        const r = await resolveContact(action.contact, user);
        if (!r.ok) return r;
        contactId = r.value;
      }
      const { ownerId, contactId: resolvedContact } = await ownerFor(dealId, contactId, user);
      const due = action.dueDate ? resolveDateToken(action.dueDate) : null;
      const task = await Task.create({
        title: action.title,
        deal: dealId,
        contact: resolvedContact ?? null,
        owner: ownerId,
        dueDate: due,
        source: "assistant",
      });
      return {
        ok: true,
        value: {
          done: `Added task "${task.title}"${due ? `, due ${due.toDateString()}` : ""}`,
          record: { entity: "task", id: String(task._id), label: task.title },
        },
      };
    }

    case "add_note": {
      let dealId: string | null = null;
      let contactId: string | null = null;
      if (action.deal) {
        const r = await resolveDeal(action.deal, user);
        if (!r.ok) return r;
        dealId = r.value;
      }
      if (action.contact) {
        const r = await resolveContact(action.contact, user);
        if (!r.ok) return r;
        contactId = r.value;
      }
      const { ownerId, contactId: resolvedContact } = await ownerFor(dealId, contactId, user);
      await createNote({
        kind: "note",
        content: action.content,
        dealId: dealId ?? undefined,
        contactId: resolvedContact ?? undefined,
        authorId: user.id,
        ownerId,
      });
      const ref: RecordRef | undefined = dealId
        ? { entity: "deal", id: dealId, label: action.deal?.name ?? "the deal" }
        : resolvedContact
          ? { entity: "contact", id: resolvedContact, label: action.contact?.name ?? "the contact" }
          : undefined;
      return { ok: true, value: { done: "Added the note", record: ref } };
    }

    case "move_deal": {
      const r = await resolveDeal(action.deal, user);
      if (!r.ok) return r;
      const deal = await loadDealForUser(r.value, user);
      const before = deal.stage;
      if (before === action.stage) {
        return { ok: true, value: { done: `"${deal.title}" was already in ${action.stage}` } };
      }
      await updateDeal(deal, { stage: action.stage }, user);
      return {
        ok: true,
        value: {
          done: `Moved "${deal.title}" from ${before} to ${action.stage}`,
          record: { entity: "deal", id: String(deal._id), label: deal.title, sublabel: action.stage },
        },
      };
    }

    case "complete_task": {
      const r = await resolveTask(action.task, user);
      if (!r.ok) return r;
      const task = await Task.findOne({ _id: r.value, ...scope(user) });
      if (!task) return { ok: false, message: "That task no longer exists." };
      task.done = true;
      await task.save();
      return { ok: true, value: { done: `Marked "${task.title}" done`, record: { entity: "task", id: String(task._id), label: task.title } } };
    }
  }
}

/** The full picture of one record, so "tell me about X" answers without a page load. */
async function loadRecord(
  entity: "contact" | "deal",
  name: string,
  user: AuthUser,
): Promise<Resolution<{ record: RecordRef; detail: unknown }>> {
  if (entity === "deal") {
    const r = await resolveDeal({ name }, user);
    if (!r.ok) return r;
    const deal = await Deal.findById(r.value).populate("contact", "name company email").populate("owner", "name email role").lean();
    if (!deal) return { ok: false, message: "That deal no longer exists." };
    const [notes, tasks] = await Promise.all([
      Note.find({ deal: deal._id }).sort({ createdAt: -1 }).limit(5).populate("author", "name email role").lean(),
      Task.find({ deal: deal._id, done: false }).sort({ dueDate: 1 }).limit(5).lean(),
    ]);
    return {
      ok: true,
      value: {
        record: { entity: "deal", id: String(deal._id), label: deal.title, sublabel: deal.stage },
        detail: { deal: toDealDTO(deal), notes: notes.map(toNoteDTO), tasks: tasks.map(toTaskDTO) },
      },
    };
  }

  const r = await resolveContact({ name }, user);
  if (!r.ok) return r;
  const contact = await Contact.findById(r.value).populate("owner", "name email role").lean();
  if (!contact) return { ok: false, message: "That contact no longer exists." };
  const [deals, notes, tasks] = await Promise.all([
    Deal.find({ contact: contact._id }).sort({ updatedAt: -1 }).limit(5).populate("contact", "name company email").populate("owner", "name email role").lean(),
    Note.find({ contact: contact._id }).sort({ createdAt: -1 }).limit(5).populate("author", "name email role").lean(),
    Task.find({ contact: contact._id, done: false }).sort({ dueDate: 1 }).limit(5).lean(),
  ]);
  return {
    ok: true,
    value: {
      record: { entity: "contact", id: String(contact._id), label: contact.name, sublabel: contact.company ?? undefined },
      detail: {
        contact: toContactDTO(contact),
        deals: deals.map(toDealDTO),
        notes: notes.map(toNoteDTO),
        tasks: tasks.map(toTaskDTO),
      },
    },
  };
}

export async function runAssistant(message: string, user: AuthUser): Promise<AssistantReply> {
  const clean = sanitizeText(message, 1000);
  const today = new Date().toISOString().slice(0, 10);

  const result = await callStructured({
    feature: "assistant",
    schema: assistantPlanLlmSchema,
    system: buildSystem(today, user.role),
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
    // translator. Nothing else can.
    const ask = await askCrm(clean, user);
    if (ask.ok) return { kind: "answer", summary: ask.explanation, ask };
    return {
      kind: "refused",
      reason:
        result.reason === "not_configured"
          ? "The assistant needs an AI provider configured. Questions about your pipeline still work without one."
          : `The assistant is temporarily unavailable (${result.reason}).`,
      details: [],
    };
  }

  const validation = validateAssistantPlan(result.data);
  if (!validation.ok) return { kind: "refused", reason: validation.reason, details: validation.details };
  const plan = validation.plan;

  if (plan.intent === "guide") {
    return { kind: "guide", summary: plan.summary, steps: plan.guidance ?? [] };
  }

  if (plan.intent === "show") {
    const loaded = await loadRecord(plan.lookup!.entity, plan.lookup!.name, user);
    if (!loaded.ok) return { kind: "refused", reason: loaded.message, details: [] };
    return { kind: "record", summary: plan.summary, record: loaded.value.record, detail: loaded.value.detail };
  }

  if (plan.intent === "answer") {
    const ask = await askCrm(clean, user);
    if (ask.ok) return { kind: "answer", summary: ask.explanation, ask };
    return { kind: "refused", reason: ask.reason, details: ask.details };
  }

  // "act": run the changes, stopping at the first one that cannot be resolved.
  const applied: string[] = [];
  const records: RecordRef[] = [];
  for (const action of plan.actions) {
    const outcome = await runAction(action, user);
    if (!outcome.ok) {
      // Anything already applied stays applied and is reported; silently
      // reversing it would be a bigger surprise than saying what stopped.
      return {
        kind: "refused",
        reason: outcome.message,
        details: applied.length ? [`Already done: ${applied.join("; ")}`] : [],
      };
    }
    applied.push(outcome.value.done);
    if (outcome.value.record) records.push(outcome.value.record);
  }

  return { kind: "applied", summary: plan.summary, applied, records };
}

export { describeAction };
