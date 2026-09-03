import { z } from "zod";
import { PIPELINE_STAGES } from "./constants";
import { NL_DATE_TOKENS } from "./nlquery";

/**
 * The set of changes the assistant is allowed to propose.
 *
 * This mirrors how natural-language queries are handled: the model never
 * produces anything executable, only a typed proposal that the server validates
 * against this allowlist and then carries out itself. The difference is that
 * these write, so two further rules apply.
 *
 * Targets are named, never identified. The model has no way to know a record id
 * and must not be trusted with one, so it says "the Globex renewal" and the
 * server resolves that against records the user is allowed to touch. An
 * ambiguous or unknown name becomes a question, never a guess.
 *
 * Nothing here destroys anything. There is no delete, no merge, no send. The
 * worst outcome of a wrong proposal is a task or note the user can remove.
 */

export const ASSISTANT_ACTIONS = ["create_task", "add_note", "move_deal", "complete_task"] as const;
export type AssistantActionKind = (typeof ASSISTANT_ACTIONS)[number];

/** How a record is referred to before the server resolves it to something real. */
export const targetRefSchema = z.object({
  /** Deal title, contact name, or task title, as the user said it. */
  name: z.string().trim().min(1).max(200),
});
export type TargetRef = z.infer<typeof targetRefSchema>;

export const MAX_NOTE_LENGTH = 4000;
export const MAX_TASK_TITLE = 300;

/** What the model is asked to return. Anything else is rejected before it reaches the database. */
export const assistantActionLlmSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create_task"),
    title: z.string().trim().min(1).max(MAX_TASK_TITLE),
    deal: targetRefSchema.nullish(),
    contact: targetRefSchema.nullish(),
    /** A token from the shared date grammar, an ISO date, or a relative offset like +3d. */
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

export const ASSISTANT_MAX_ACTIONS = 5;

export const assistantPlanLlmSchema = z.object({
  /** "answer" when the message is a question, "act" when it asks for a change. */
  intent: z.enum(["answer", "act", "unsupported"]),
  /** One sentence, in the user's own terms, describing what will happen. */
  summary: z.string().trim().min(1).max(400),
  actions: z.array(assistantActionLlmSchema).max(ASSISTANT_MAX_ACTIONS).default([]),
});
export type AssistantPlanLlm = z.infer<typeof assistantPlanLlmSchema>;

export type AssistantValidation =
  | { ok: true; plan: AssistantPlanLlm }
  | { ok: false; code: "invalid" | "unsupported"; reason: string; details: string[] };

const DATE_TOKEN_SET = new Set<string>(NL_DATE_TOKENS);
const RELATIVE_RE = /^[+-]\d{1,4}[dwmy]$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A due date must come from the same grammar queries use, so there is one thing to reason about. */
export function isValidDueDate(raw: string): boolean {
  return DATE_TOKEN_SET.has(raw) || RELATIVE_RE.test(raw) || ISO_DATE_RE.test(raw);
}

/**
 * Checks a proposal from the model against the allowlist above.
 *
 * Rejection is always the safe outcome: a malformed plan becomes a message to
 * the user, never a partially applied change.
 */
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
  if (plan.intent === "answer" && plan.actions.length > 0) {
    return {
      ok: false,
      code: "invalid",
      reason: "The assistant marked this as a question but still proposed changes.",
      details: [],
    };
  }
  if (plan.intent === "act" && plan.actions.length === 0) {
    return { ok: false, code: "invalid", reason: "The assistant proposed no action to take.", details: [] };
  }

  const details: string[] = [];
  for (const [i, action] of plan.actions.entries()) {
    const at = `actions[${i}]`;

    if (action.kind === "create_task") {
      if (action.dueDate && !isValidDueDate(action.dueDate)) {
        details.push(`${at}.dueDate: "${action.dueDate}" is not a date this system understands`);
      }
      if (!action.deal && !action.contact) {
        details.push(`${at}: a task must be attached to a deal or a contact`);
      }
    }

    if (action.kind === "add_note" && !action.deal && !action.contact) {
      details.push(`${at}: a note must be attached to a deal or a contact`);
    }
  }

  if (details.length > 0) {
    return { ok: false, code: "invalid", reason: "The proposed changes were not usable.", details };
  }
  return { ok: true, plan };
}

/** One line describing an action, for the confirmation the user sees before anything happens. */
export function describeAction(action: AssistantActionLlm): string {
  switch (action.kind) {
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

/**
 * An action after the server has resolved every name to a record the user is
 * allowed to touch. This is what the client confirms, and what comes back to be
 * executed.
 *
 * Ids here are not trusted on the way back in. Execution re-loads every record
 * through the same ownership checks the REST routes use, so a tampered id fails
 * exactly as it would on any other endpoint.
 */
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "not a record id");

export const resolvedActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create_task"),
    title: z.string().trim().min(1).max(MAX_TASK_TITLE),
    deal: objectId.nullable(),
    contact: objectId.nullable(),
    dueDate: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("add_note"),
    content: z.string().trim().min(1).max(MAX_NOTE_LENGTH),
    deal: objectId.nullable(),
    contact: objectId.nullable(),
  }),
  z.object({
    kind: z.literal("move_deal"),
    deal: objectId,
    stage: z.enum(PIPELINE_STAGES),
  }),
  z.object({
    kind: z.literal("complete_task"),
    task: objectId,
  }),
]);
export type ResolvedAction = z.infer<typeof resolvedActionSchema>;

/** One proposed step: what will happen, in words, and the change itself. */
export interface AssistantStep {
  description: string;
  action: ResolvedAction;
}

export type AssistantReply =
  /** A question that was answered by running a read-only query. */
  | { kind: "answer"; summary: string; ask: unknown }
  /** Changes waiting for the user to confirm. Nothing has happened yet. */
  | { kind: "proposal"; summary: string; steps: AssistantStep[] }
  /** Could not be turned into either. */
  | { kind: "refused"; reason: string; details: string[] };

export const assistantExecuteSchema = z.object({
  actions: z.array(resolvedActionSchema).min(1).max(ASSISTANT_MAX_ACTIONS),
});
