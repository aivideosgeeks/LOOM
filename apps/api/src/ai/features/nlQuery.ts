import { Types } from "mongoose";
import {
  describeFilter,
  nlQueryLlmSchema,
  OPEN_STAGES,
  CLOSED_STAGES,
  validateNlQuery,
  type ContactDTO,
  type DealDTO,
  type NlQueryLlm,
  type ValidatedFilter,
  type ValidatedNlQuery,
} from "@loom/shared";
import type { AuthUser } from "../../middleware/auth";
import { sha256 } from "../../lib/hash";
import { Contact, Deal, User } from "../../models";
import { toContactDTO, toDealDTO } from "../../services/serializers";
import { callStructured } from "../gateway";
import { buildNlQuerySystem } from "../prompts";
import { sanitizeText, wrapData } from "../sanitize";

export type AskResult =
  | {
      ok: true;
      entity: "deals" | "contacts";
      explanation: string;
      filters: string[];
      rows: DealDTO[] | ContactDTO[];
      count: number;
      limit: number;
      scopedToOwn: boolean;
      translator: "ai" | "heuristic";
    }
  | { ok: false; code: "unsupported" | "invalid" | "unavailable"; reason: string; details: string[] };

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ci = (s: string) => new RegExp(escapeRegex(s), "i");
const exact = (s: string) => new RegExp(`^${escapeRegex(s)}$`, "i");

export interface CompileResolvers {
  userIdsByName(name: string): Promise<Types.ObjectId[]>;
  contactIdsWhere(filter: Record<string, unknown>): Promise<Types.ObjectId[]>;
}

/**
 * Turns a validated DSL query into a Mongo filter. Only ever produces read filters on
 * allowlisted paths, and always ANDs the caller's ownership scope for members.
 */
export async function compileNlQuery(
  query: ValidatedNlQuery,
  user: AuthUser,
  resolvers: CompileResolvers,
): Promise<{ filter: Record<string, unknown>; sort: Record<string, 1 | -1>; limit: number; scopedToOwn: boolean }> {
  const clauses: Record<string, unknown>[] = [];

  const compileClause = async (f: ValidatedFilter): Promise<Record<string, unknown>> => {
    switch (f.type) {
      case "string": {
        // deals.contactName / deals.company live on the contact document
        if (query.entity === "deals" && (f.field === "contactName" || f.field === "company")) {
          const path = f.field === "contactName" ? "name" : "company";
          const sub = f.op === "in" ? { [path]: { $in: f.values.map(exact) } } : f.op === "contains" ? { [path]: ci(f.value) } : f.op === "eq" ? { [path]: exact(f.value) } : { [path]: { $not: exact(f.value) } };
          const ids = await resolvers.contactIdsWhere(sub);
          return { contact: { $in: ids } };
        }
        if (f.op === "in") return { [f.field]: { $in: f.values.map(exact) } };
        if (f.op === "contains") return { [f.field]: ci(f.value) };
        if (f.op === "eq") return { [f.field]: exact(f.value) };
        return { [f.field]: { $not: exact(f.value) } };
      }
      case "number": {
        if (f.op === "between") return { [f.field]: { $gte: f.value, $lte: f.value2 } };
        const ops: Record<string, string> = { eq: "$eq", ne: "$ne", gt: "$gt", gte: "$gte", lt: "$lt", lte: "$lte" };
        return { [f.field]: { [ops[f.op]]: f.value } };
      }
      case "date": {
        if ("range" in f) return { [f.field]: { $gte: f.range.start, $lte: f.range.end } };
        return f.op === "before" ? { [f.field]: { $lt: f.value } } : { [f.field]: { $gt: f.value } };
      }
      case "stage": {
        if (f.op === "in") return { stage: { $in: f.values } };
        return f.op === "eq" ? { stage: f.value } : { stage: { $ne: f.value } };
      }
      case "boolean":
        return f.value ? { "risk.atRisk": true } : { "risk.atRisk": { $ne: true } };
      case "owner": {
        const ids = f.value === "me" ? [new Types.ObjectId(user.id)] : await resolvers.userIdsByName(f.value);
        return f.op === "eq" ? { owner: { $in: ids } } : { owner: { $nin: ids } };
      }
      case "tags":
        if (f.op === "in") return { tags: { $in: f.values.map(exact) } };
        return { tags: exact(f.value) };
    }
  };

  for (const f of query.filters) clauses.push(await compileClause(f));

  const scopedToOwn = user.role !== "admin";
  if (scopedToOwn) clauses.push({ owner: new Types.ObjectId(user.id) });
  if (query.entity === "contacts") clauses.push({ mergedInto: null });

  const sort: Record<string, 1 | -1> = query.sort
    ? { [query.sort.field]: query.sort.direction === "asc" ? 1 : -1 }
    : query.entity === "deals"
      ? { score: -1, updatedAt: -1 }
      : { lastActivityAt: -1 };

  return { filter: clauses.length ? { $and: clauses } : {}, sort, limit: query.limit, scopedToOwn };
}

export const dbResolvers: CompileResolvers = {
  async userIdsByName(name) {
    const users = await User.find({ name: ci(name) }).select("_id").lean();
    return users.map((u) => u._id as Types.ObjectId);
  },
  async contactIdsWhere(filter) {
    const contacts = await Contact.find({ ...filter, mergedInto: null }).select("_id").limit(2000).lean();
    return contacts.map((c) => c._id as Types.ObjectId);
  },
};

/**
 * Minimal rule-based translator used only when the LLM is unavailable, so the feature
 * still answers the most common questions instead of failing outright.
 */
export function heuristicTranslate(question: string): NlQueryLlm | null {
  const q = question.toLowerCase();
  const filters: NlQueryLlm["filters"] = [];
  const mk = (field: string, op: NlQueryLlm["filters"][number]["op"], value: string | number | boolean | null, value2: string | number | null = null, values: string[] | null = null) =>
    filters.push({ field, op, value, value2, values });

  if (/\b(create|add|delete|remove|update|send|email|draft|merge|edit)\b/.test(q)) return null;
  const entity: "deals" | "contacts" = /\bcontacts?\b|\bpeople\b|\bleads?\b(?!.*deal)/.test(q) && !/\bdeals?\b/.test(q) ? "contacts" : "deals";

  const money = /(?:over|above|more than|greater than|>)\s*\$?\s*(\d[\d,.]*)\s*(k|m)?/.exec(q);
  if (money && entity === "deals") mk("value", "gt", parseMoney(money[1], money[2]));
  const under = /(?:under|below|less than|<)\s*\$?\s*(\d[\d,.]*)\s*(k|m)?/.exec(q);
  if (under && entity === "deals") mk("value", "lt", parseMoney(under[1], under[2]));

  if (/closing this month|close this month|closes this month/.test(q)) mk("expectedCloseDate", "between", "start_of_month", "end_of_month");
  else if (/closing this week/.test(q)) mk("expectedCloseDate", "between", "start_of_week", "end_of_week");
  else if (/closing this quarter/.test(q)) mk("expectedCloseDate", "between", "start_of_quarter", "end_of_quarter");
  else if (/closing next month/.test(q)) mk("expectedCloseDate", "between", "start_of_next_month", "end_of_next_month");

  const touched = /(?:not|haven't|havent|no)\s+(?:been\s+)?(?:touched|contacted|activity|updated)\s+(?:in|for)\s+(\d+)\s+days?/.exec(q) ?? /(\d+)\s+days?\s+(?:without|of no)\s+(?:activity|contact)/.exec(q);
  if (touched) mk("lastActivityAt", "before", `-${touched[1]}d`);
  const created = /created\s+(?:in\s+the\s+)?(?:last|past)\s+(\d+)\s+days?/.exec(q);
  if (created) mk("createdAt", "after", `-${created[1]}d`);

  if (/\bat risk\b|\brisky\b|\bstalled\b/.test(q) && entity === "deals") mk("atRisk", "eq", true);
  if (/\bmy\b/.test(q)) mk("owner", "eq", "me");
  if (/\bopen\b|\bactive\b/.test(q) && entity === "deals") mk("stage", "in", null, null, [...OPEN_STAGES]);
  if (/\bclosed\b/.test(q) && entity === "deals") mk("stage", "in", null, null, [...CLOSED_STAGES]);
  for (const stage of ["lead", "contacted", "proposal", "negotiation", "won", "lost"]) {
    if (new RegExp(`\\bin ${stage}\\b|\\b${stage} stage\\b|\\bstage (?:is |= )?${stage}\\b`).test(q) && entity === "deals") {
      mk("stage", "eq", stage[0].toUpperCase() + stage.slice(1));
    }
  }
  const company = /\b(?:at|from|with)\s+(?:company\s+)?([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*)*)/.exec(question);
  if (company) mk("company", "contains", company[1]);
  const tag = /\btag(?:ged)?\s+(?:with\s+)?["']?([\w-]+)["']?/.exec(q);
  if (tag && entity === "contacts") mk("tags", "contains", tag[1]);
  const hot = /\b(hot|strong|best|top)\b/.test(q);
  if (hot && entity === "deals") mk("score", "gte", 70);

  if (!filters.length) return null;
  const sort = /\b(biggest|largest|highest value)\b/.test(q) ? { field: "value", direction: "desc" as const } : /\b(best|top|hot)\b/.test(q) ? { field: "score", direction: "desc" as const } : null;
  return { kind: "query", entity, filters, sort, limit: null, explanation: `Rule-based interpretation of: ${question.trim()}`, reason: null };
}

function parseMoney(num: string, suffix?: string): number {
  const n = Number(num.replace(/,/g, ""));
  return suffix === "k" ? n * 1_000 : suffix === "m" ? n * 1_000_000 : n;
}

export async function translateQuestion(question: string, user: AuthUser): Promise<{ raw: NlQueryLlm; translator: "ai" | "heuristic" } | { raw: null; reason: string }> {
  const clean = sanitizeText(question, 500);
  const today = new Date().toISOString().slice(0, 10);
  const result = await callStructured({
    feature: "nl_query",
    schema: nlQueryLlmSchema,
    system: buildNlQuerySystem(today),
    user: wrapData("question", clean, { role: user.role }, 500),
    effort: "low",
    maxTokens: 4096,
    timeoutMs: 45_000,
    cache: { key: sha256({ q: clean.toLowerCase(), today, role: user.role }), ttlMs: 60 * 60_000 },
    userId: user.id,
  });
  if (result.ok) return { raw: result.data, translator: "ai" };
  const heuristic = heuristicTranslate(clean);
  if (heuristic) return { raw: heuristic, translator: "heuristic" };
  return { raw: null, reason: result.reason === "not_configured" ? "AI is not configured and this question is not covered by the built-in rules." : `AI is temporarily unavailable (${result.reason}).` };
}

export async function askCrm(question: string, user: AuthUser): Promise<AskResult> {
  const translated = await translateQuestion(question, user);
  if (!translated.raw) return { ok: false, code: "unavailable", reason: translated.reason, details: [] };

  const validation = validateNlQuery(translated.raw);
  if (!validation.ok) return { ok: false, code: validation.code, reason: validation.reason, details: validation.details };

  const compiled = await compileNlQuery(validation.query, user, dbResolvers);
  if (validation.query.entity === "deals") {
    const docs = await Deal.find(compiled.filter).sort(compiled.sort).limit(compiled.limit).populate("contact", "name company email").populate("owner", "name email role").lean();
    return {
      ok: true,
      entity: "deals",
      explanation: validation.query.explanation,
      filters: validation.query.filters.map(describeFilter),
      rows: docs.map(toDealDTO),
      count: docs.length,
      limit: compiled.limit,
      scopedToOwn: compiled.scopedToOwn,
      translator: translated.translator,
    };
  }
  const docs = await Contact.find(compiled.filter).sort(compiled.sort).limit(compiled.limit).populate("owner", "name email role").lean();
  return {
    ok: true,
    entity: "contacts",
    explanation: validation.query.explanation,
    filters: validation.query.filters.map(describeFilter),
    rows: docs.map((d) => toContactDTO(d)),
    count: docs.length,
    limit: compiled.limit,
    scopedToOwn: compiled.scopedToOwn,
    translator: translated.translator,
  };
}
