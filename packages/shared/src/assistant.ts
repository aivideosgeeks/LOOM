import { z } from "zod";
import { PIPELINE_STAGES } from "./constants";
import { NL_DATE_TOKENS } from "./nlquery";

/**
 * What the assistant is allowed to do.
 *
 * The model never produces anything executable. It returns a typed proposal
 * that the server checks against this allowlist, resolves against records the
 * user may touch, and then performs itself. Two rules make that safe enough to
 * apply without a confirmation step.
 *
 * Targets are named, never identified. The model has no way to know a record id
 * and no business inventing one, so it says "the Globex renewal" and the server
 * resolves it. An ambiguous name becomes a question, never a guess.
 *
 * Nothing here destroys anything. There is no delete, no merge, no send, no
 * role change. Every action either creates a record or moves one between
 * states a person can move it back from.
 */

export const ASSISTANT_ACTIONS = [
  "create_contact",
  "create_deal",
  "create_task",
  "add_note",
  "move_deal",
  "complete_task",
] as const;
export type AssistantActionKind = (typeof ASSISTANT_ACTIONS)[number];

/** How a record is referred to before the server resolves it to something real. */
export const targetRefSchema = z.object({
  name: z.string().trim().min(1).max(200),
});
export type TargetRef = z.infer<typeof targetRefSchema>;

export const MAX_NOTE_LENGTH = 4000;
export const MAX_TASK_TITLE = 300;
export const ASSISTANT_MAX_ACTIONS = 5;

export const assistantActionLlmSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create_contact"),
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().max(200).nullish(),
    phone: z.string().trim().max(60).nullish(),
    company: z.string().trim().max(200).nullish(),
    tags: z.array(z.string().trim().min(1).max(40)).max(8).nullish(),
  }),
  z.object({
    kind: z.literal("create_deal"),
    title: z.string().trim().min(1).max(200),
    contact: targetRefSchema,
    value: z.number().nonnegative().max(1_000_000_000).nullish(),
    stage: z.enum(PIPELINE_STAGES).nullish(),
    expectedCloseDate: z.string().trim().max(40).nullish(),
  }),
  z.object({
    kind: z.literal("create_task"),
    title: z.string().trim().min(1).max(MAX_TASK_TITLE),
    deal: targetRefSchema.nullish(),
    contact: targetRefSchema.nullish(),
    dueDate: z.string().trim().max(40).nullish(),
  }),
  z.object({
    kind: z.literal("add_note"),
    content: z.string().trim().min(1).max(MAX_NOTE_LENGTH),
    deal: targetRefSchema.nullish(),
    contact: targetRefSchema.nullish(),
  }),
  z.object({
    kind: z.literal("move_deal"),
    deal: targetRefSchema,
    stage: z.enum(PIPELINE_STAGES),
  }),
  z.object({
    kind: z.literal("complete_task"),
    task: targetRefSchema,
  }),
]);
export type AssistantActionLlm = z.infer<typeof assistantActionLlmSchema>;

export const ASSISTANT_INTENTS = ["answer", "act", "show", "guide", "unsupported"] as const;
export type AssistantIntent = (typeof ASSISTANT_INTENTS)[number];

export const assistantPlanLlmSchema = z.object({
  /**
   * answer  - a question about existing records; the CRM runs a validated query
   * act     - a request to change something; actions are filled in
   * show    - "open X" / "tell me about X"; lookup is filled in
   * guide   - "how do I ...?" about using the CRM itself; guidance is filled in
   */
  intent: z.enum(ASSISTANT_INTENTS),
  summary: z.string().trim().min(1).max(400),
  actions: z.array(assistantActionLlmSchema).max(ASSISTANT_MAX_ACTIONS).default([]),
  lookup: z
    .object({ entity: z.enum(["contact", "deal"]), name: z.string().trim().min(1).max(200) })
    .nullish(),
  /** Numbered steps for a how-to. Grounded in the product description given to the model. */
  guidance: z.array(z.string().trim().min(1).max(400)).max(10).nullish(),
});
export type AssistantPlanLlm = z.infer<typeof assistantPlanLlmSchema>;

export type AssistantValidation =
  | { ok: true; plan: AssistantPlanLlm }
  | { ok: false; code: "invalid" | "unsupported"; reason: string; details: string[] };

const DATE_TOKEN_SET = new Set<string>(NL_DATE_TOKENS);
const RELATIVE_RE = /^[+-]\d{1,4}[dwmy]$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Dates must use the same grammar queries use, so there is one thing to reason about. */
export function isValidDueDate(raw: string): boolean {
  return DATE_TOKEN_SET.has(raw) || RELATIVE_RE.test(raw) || ISO_DATE_RE.test(raw);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateAssistantPlan(raw: unknown): AssistantValidation {
  const parsed = assistantPlanLlmSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid",
      reason: "The assistant proposed something that does not fit the allowed shape.",
      details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }

  const plan = parsed.data;
  if (plan.intent === "unsupported") {
    return { ok: false, code: "unsupported", reason: plan.summary, details: [] };
  }
  if (plan.intent !== "act" && plan.actions.length > 0) {
    return {
      ok: false,
      code: "invalid",
      reason: "The assistant proposed changes for something that was not a request to change anything.",
      details: [],
    };
  }
  if (plan.intent === "act" && plan.actions.length === 0) {
    return { ok: false, code: "invalid", reason: "The assistant proposed no action to take.", details: [] };
  }
  if (plan.intent === "show" && !plan.lookup) {
    return { ok: false, code: "invalid", reason: "The assistant did not say which record to open.", details: [] };
  }
  if (plan.intent === "guide" && (!plan.guidance || plan.guidance.length === 0)) {
    return { ok: false, code: "invalid", reason: "The assistant gave no steps to follow.", details: [] };
  }

  const details: string[] = [];
  for (const [i, action] of plan.actions.entries()) {
    const at = `actions[${i}]`;

    if (action.kind === "create_task") {
      if (action.dueDate && !isValidDueDate(action.dueDate)) {
        details.push(`${at}.dueDate: "${action.dueDate}" is not a date this system understands`);
      }
      if (!action.deal && !action.contact) details.push(`${at}: a task must be attached to a deal or a contact`);
    }

    if (action.kind === "add_note" && !action.deal && !action.contact) {
      details.push(`${at}: a note must be attached to a deal or a contact`);
    }

    if (action.kind === "create_contact" && action.email && !EMAIL_RE.test(action.email)) {
      details.push(`${at}.email: "${action.email}" is not an email address`);
    }

    if (action.kind === "create_deal" && action.expectedCloseDate && !isValidDueDate(action.expectedCloseDate)) {
      details.push(`${at}.expectedCloseDate: "${action.expectedCloseDate}" is not a date this system understands`);
    }
  }

  if (details.length > 0) {
    return { ok: false, code: "invalid", reason: "The proposed changes were not usable.", details };
  }
  return { ok: true, plan };
}

/** One line describing an action, used in the record of what was done. */
export function describeAction(action: AssistantActionLlm): string {
  switch (action.kind) {
    case "create_contact":
      return `Add contact ${action.name}${action.company ? ` at ${action.company}` : ""}`;
    case "create_deal":
      return `Create deal "${action.title}" for ${action.contact.name}`;
    case "create_task": {
      const target = action.deal?.name ?? action.contact?.name ?? "";
      const when = action.dueDate ? `, due ${action.dueDate.replace(/_/g, " ")}` : "";
      return `Add task "${action.title}" on ${target}${when}`;
    }
    case "add_note": {
      const target = action.deal?.name ?? action.contact?.name ?? "";
      const preview = action.content.length > 60 ? `${action.content.slice(0, 60)}…` : action.content;
      return `Add a note to ${target}: "${preview}"`;
    }
    case "move_deal":
      return `Move ${action.deal.name} to ${action.stage}`;
    case "complete_task":
      return `Mark "${action.task.name}" as done`;
  }
}

/** A record the assistant touched or was asked about, enough to link and preview it. */
export interface RecordRef {
  entity: "contact" | "deal" | "task";
  id: string;
  label: string;
  sublabel?: string;
}

export type AssistantReply =
  /** A question answered by running a validated read-only query. */
  | { kind: "answer"; summary: string; ask: unknown }
  /** Changes that were carried out, with links to what they touched. */
  | { kind: "applied"; summary: string; applied: string[]; records: RecordRef[] }
  /** A record the user asked to see, with a preview. */
  | { kind: "record"; summary: string; record: RecordRef; detail: unknown }
  /** How to do something in the CRM. */
  | { kind: "guide"; summary: string; steps: string[] }
  | { kind: "refused"; reason: string; details: string[] };
