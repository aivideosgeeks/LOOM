import { z } from "zod";
import { PIPELINE_STAGES, type Stage } from "./constants";

/**
 * Natural-language query DSL.
 *
 * The LLM never produces a database query. It produces this small, typed JSON
 * structure, which is then validated against a per-entity field allowlist and
 * compiled to a read-only MongoDB filter by our own code.
 */

export const NL_ENTITIES = ["deals", "contacts"] as const;
export type NlEntity = (typeof NL_ENTITIES)[number];

export type NlFieldType = "string" | "number" | "date" | "stage" | "boolean" | "owner" | "tags";

export interface NlFieldSpec {
  type: NlFieldType;
  description: string;
  sortable: boolean;
}

export const NL_FIELDS: Record<NlEntity, Record<string, NlFieldSpec>> = {
  deals: {
    title: { type: "string", description: "Deal title", sortable: true },
    value: { type: "number", description: "Deal value in USD", sortable: true },
    stage: { type: "stage", description: "Pipeline stage", sortable: true },
    expectedCloseDate: { type: "date", description: "Expected close date", sortable: true },
    createdAt: { type: "date", description: "When the deal was created", sortable: true },
    lastActivityAt: { type: "date", description: "Last activity (note, call, email, meeting or update)", sortable: true },
    stageEnteredAt: { type: "date", description: "When the deal entered its current stage", sortable: true },
    score: { type: "number", description: "AI lead score, 0-100 (higher = more likely to close)", sortable: true },
    atRisk: { type: "boolean", description: "Whether the deal is currently flagged at risk", sortable: false },
    owner: { type: "owner", description: "Deal owner. Use the literal string 'me' for the current user, otherwise a person's name", sortable: false },
    contactName: { type: "string", description: "Name of the associated contact", sortable: false },
    company: { type: "string", description: "Company of the associated contact", sortable: false },
  },
  contacts: {
    name: { type: "string", description: "Contact full name", sortable: true },
    email: { type: "string", description: "Email address", sortable: true },
    company: { type: "string", description: "Company name", sortable: true },
    tags: { type: "tags", description: "Tags attached to the contact", sortable: false },
    createdAt: { type: "date", description: "When the contact was created", sortable: true },
    lastActivityAt: { type: "date", description: "Last touch (note, call, email, meeting or deal activity)", sortable: true },
    score: { type: "number", description: "AI lead score, 0-100", sortable: true },
    owner: { type: "owner", description: "Contact owner. Use 'me' for the current user, otherwise a person's name", sortable: false },
  },
};

export const NL_OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "in", "contains", "before", "after", "between"] as const;
export type NlOp = (typeof NL_OPS)[number];

export const OPS_BY_TYPE: Record<NlFieldType, readonly NlOp[]> = {
  string: ["eq", "ne", "contains", "in"],
  number: ["eq", "ne", "gt", "gte", "lt", "lte", "between"],
  date: ["before", "after", "between", "eq"],
  stage: ["eq", "ne", "in"],
  boolean: ["eq"],
  owner: ["eq", "ne"],
  tags: ["contains", "in"],
};

export const NL_LIMIT_DEFAULT = 50;
export const NL_LIMIT_MAX = 200;
export const NL_MAX_FILTERS = 8;

/** Loose schema handed to the model as the structured-output format. Constraints are enforced in validateNlQuery. */
export const nlFilterLlmSchema = z.object({
  field: z.string(),
  op: z.enum(NL_OPS),
  value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  value2: z.union([z.string(), z.number()]).nullable(),
  values: z.array(z.string()).nullable(),
});

export const nlQueryLlmSchema = z.object({
  kind: z.enum(["query", "unsupported"]),
  entity: z.enum(NL_ENTITIES).nullable(),
  filters: z.array(nlFilterLlmSchema),
  sort: z.object({ field: z.string(), direction: z.enum(["asc", "desc"]) }).nullable(),
  limit: z.number().nullable(),
  explanation: z.string(),
  reason: z.string().nullable(),
});
export type NlQueryLlm = z.infer<typeof nlQueryLlmSchema>;

// ---------- Validated (strict) representation ----------

export type NlDateRange = { start: Date; end: Date };

export type ValidatedFilter =
  | { field: string; type: "string"; op: "eq" | "ne" | "contains"; value: string }
  | { field: string; type: "string"; op: "in"; values: string[] }
  | { field: string; type: "number"; op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte"; value: number }
  | { field: string; type: "number"; op: "between"; value: number; value2: number }
  | { field: string; type: "date"; op: "before" | "after"; value: Date }
  | { field: string; type: "date"; op: "between" | "eq"; range: NlDateRange }
  | { field: string; type: "stage"; op: "eq" | "ne"; value: Stage }
  | { field: string; type: "stage"; op: "in"; values: Stage[] }
  | { field: string; type: "boolean"; op: "eq"; value: boolean }
  | { field: string; type: "owner"; op: "eq" | "ne"; value: "me" | string }
  | { field: string; type: "tags"; op: "contains"; value: string }
  | { field: string; type: "tags"; op: "in"; values: string[] };

export interface ValidatedNlQuery {
  entity: NlEntity;
  filters: ValidatedFilter[];
  sort: { field: string; direction: "asc" | "desc" } | null;
  limit: number;
  explanation: string;
}

export type NlValidation =
  | { ok: true; query: ValidatedNlQuery }
  | { ok: false; code: "unsupported" | "invalid"; reason: string; details: string[] };

// ---------- Relative date grammar ----------

export const NL_DATE_TOKENS = [
  "today", "now", "yesterday", "tomorrow",
  "start_of_week", "end_of_week", "start_of_next_week", "end_of_next_week", "start_of_last_week", "end_of_last_week",
  "start_of_month", "end_of_month", "start_of_next_month", "end_of_next_month", "start_of_last_month", "end_of_last_month",
  "start_of_quarter", "end_of_quarter", "start_of_next_quarter", "end_of_next_quarter", "start_of_last_quarter", "end_of_last_quarter",
  "start_of_year", "end_of_year", "start_of_next_year", "end_of_next_year", "start_of_last_year", "end_of_last_year",
] as const;

const RELATIVE_RE = /^([+-])(\d{1,4})([dwmy])$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}
function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  return addDays(x, -day);
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfQuarter(d: Date): Date {
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
}
function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}

/** Resolve a date token (ISO date, ISO datetime, or relative grammar) to a Date. Returns null when unrecognised. */
export function resolveDateToken(raw: string, now: Date = new Date()): Date | null {
  const trimmed = raw.trim();
  if (ISO_DATE_RE.test(trimmed)) {
    const [y, m, d] = trimmed.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (/^\d{4}-\d{2}-\d{2}t/i.test(trimmed)) {
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const rel = RELATIVE_RE.exec(trimmed.toLowerCase());
  if (rel) {
    const sign = rel[1] === "-" ? -1 : 1;
    const n = Number(rel[2]) * sign;
    switch (rel[3]) {
      case "d": return addDays(now, n);
      case "w": return addDays(now, n * 7);
      case "m": return addMonths(now, n);
      case "y": return addMonths(now, n * 12);
    }
  }
  const t = trimmed.toLowerCase().replace(/[\s-]+/g, "_");
  switch (t) {
    case "now": return new Date(now);
    case "today": return startOfDay(now);
    case "yesterday": return startOfDay(addDays(now, -1));
    case "tomorrow": return startOfDay(addDays(now, 1));
    case "start_of_week": return startOfWeek(now);
    case "end_of_week": return endOfDay(addDays(startOfWeek(now), 6));
    case "start_of_next_week": return addDays(startOfWeek(now), 7);
    case "end_of_next_week": return endOfDay(addDays(startOfWeek(now), 13));
    case "start_of_last_week": return addDays(startOfWeek(now), -7);
    case "end_of_last_week": return endOfDay(addDays(startOfWeek(now), -1));
    case "start_of_month": return startOfMonth(now);
    case "end_of_month": return endOfDay(addDays(startOfMonth(addMonths(now, 1)), -1));
    case "start_of_next_month": return startOfMonth(addMonths(now, 1));
    case "end_of_next_month": return endOfDay(addDays(startOfMonth(addMonths(now, 2)), -1));
    case "start_of_last_month": return startOfMonth(addMonths(now, -1));
    case "end_of_last_month": return endOfDay(addDays(startOfMonth(now), -1));
    case "start_of_quarter": return startOfQuarter(now);
    case "end_of_quarter": return endOfDay(addDays(addMonths(startOfQuarter(now), 3), -1));
    case "start_of_next_quarter": return addMonths(startOfQuarter(now), 3);
    case "end_of_next_quarter": return endOfDay(addDays(addMonths(startOfQuarter(now), 6), -1));
    case "start_of_last_quarter": return addMonths(startOfQuarter(now), -3);
    case "end_of_last_quarter": return endOfDay(addDays(startOfQuarter(now), -1));
    case "start_of_year": return startOfYear(now);
    case "end_of_year": return endOfDay(new Date(now.getFullYear(), 11, 31));
    case "start_of_next_year": return new Date(now.getFullYear() + 1, 0, 1);
    case "end_of_next_year": return endOfDay(new Date(now.getFullYear() + 1, 11, 31));
    case "start_of_last_year": return new Date(now.getFullYear() - 1, 0, 1);
    case "end_of_last_year": return endOfDay(new Date(now.getFullYear() - 1, 11, 31));
  }
  return null;
}

// ---------- Validation ----------

const MAX_STRING = 200;
const MAX_VALUES = 20;

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[$,\s]/g, "").toLowerCase();
    const m = /^(-?\d+(?:\.\d+)?)([km])?$/.exec(cleaned);
    if (!m) return null;
    const base = Number(m[1]);
    const mult = m[2] === "k" ? 1_000 : m[2] === "m" ? 1_000_000 : 1;
    return base * mult;
  }
  return null;
}

function toBoolean(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "yes", "1"].includes(s)) return true;
    if (["false", "no", "0"].includes(s)) return false;
  }
  return null;
}

function toStage(v: unknown): Stage | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return PIPELINE_STAGES.find((st) => st.toLowerCase() === s) ?? null;
}

function cleanString(v: unknown): string | null {
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > MAX_STRING) return null;
  return s;
}

function hasDollarKeys(v: unknown): boolean {
  if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k.startsWith("$")) return true;
      if (hasDollarKeys(val)) return true;
    }
  }
  return false;
}

export function validateNlQuery(raw: unknown, opts: { now?: Date } = {}): NlValidation {
  const now = opts.now ?? new Date();
  const details: string[] = [];

  if (hasDollarKeys(raw)) {
    return { ok: false, code: "invalid", reason: "Query contains operator-like keys, which are not allowed.", details: ["$-prefixed keys"] };
  }

  const parsed = nlQueryLlmSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid",
      reason: "The generated query did not match the expected structure.",
      details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  const q = parsed.data;

  if (q.kind === "unsupported") {
    return { ok: false, code: "unsupported", reason: q.reason?.trim() || "This question is outside what the CRM can answer.", details: [] };
  }
  if (!q.entity) {
    return { ok: false, code: "invalid", reason: "The query did not specify whether to search deals or contacts.", details: [] };
  }
  const fields = NL_FIELDS[q.entity];
  if (q.filters.length > NL_MAX_FILTERS) {
    return { ok: false, code: "invalid", reason: `Too many filters (max ${NL_MAX_FILTERS}).`, details: [] };
  }

  const filters: ValidatedFilter[] = [];
  for (const f of q.filters) {
    const spec = fields[f.field];
    if (!spec) {
      details.push(`Unknown field "${f.field}" for ${q.entity}`);
      continue;
    }
    if (!OPS_BY_TYPE[spec.type].includes(f.op)) {
      details.push(`Operator "${f.op}" is not allowed on ${f.field} (${spec.type})`);
      continue;
    }
    const field = f.field;
    switch (spec.type) {
      case "string": {
        if (f.op === "in") {
          const values = (f.values ?? []).map(cleanString).filter((s): s is string => !!s).slice(0, MAX_VALUES);
          if (!values.length) { details.push(`${field}: "in" needs a non-empty values list`); continue; }
          filters.push({ field, type: "string", op: "in", values });
        } else {
          const value = cleanString(f.value);
          if (!value) { details.push(`${field}: missing or invalid value`); continue; }
          filters.push({ field, type: "string", op: f.op as "eq" | "ne" | "contains", value });
        }
        break;
      }
      case "number": {
        const value = toNumber(f.value);
        if (value === null) { details.push(`${field}: expected a number`); continue; }
        if (f.op === "between") {
          const value2 = toNumber(f.value2);
          if (value2 === null) { details.push(`${field}: "between" needs value2`); continue; }
          filters.push({ field, type: "number", op: "between", value: Math.min(value, value2), value2: Math.max(value, value2) });
        } else {
          filters.push({ field, type: "number", op: f.op as "eq" | "ne" | "gt" | "gte" | "lt" | "lte", value });
        }
        break;
      }
      case "date": {
        const v1 = typeof f.value === "string" ? resolveDateToken(f.value, now) : null;
        if (!v1) { details.push(`${field}: unrecognised date "${String(f.value)}"`); continue; }
        if (f.op === "before" || f.op === "after") {
          filters.push({ field, type: "date", op: f.op, value: v1 });
        } else if (f.op === "eq") {
          filters.push({ field, type: "date", op: "eq", range: { start: startOfDay(v1), end: endOfDay(v1) } });
        } else {
          const v2 = typeof f.value2 === "string" ? resolveDateToken(f.value2, now) : null;
          if (!v2) { details.push(`${field}: "between" needs a valid value2 date`); continue; }
          const [start, end] = v1 <= v2 ? [v1, v2] : [v2, v1];
          filters.push({ field, type: "date", op: "between", range: { start, end } });
        }
        break;
      }
      case "stage": {
        if (f.op === "in") {
          const values = (f.values ?? []).map(toStage).filter((s): s is Stage => !!s);
          if (!values.length) { details.push(`${field}: no valid stages in list`); continue; }
          filters.push({ field, type: "stage", op: "in", values });
        } else {
          const value = toStage(f.value);
          if (!value) { details.push(`${field}: unknown stage "${String(f.value)}"`); continue; }
          filters.push({ field, type: "stage", op: f.op as "eq" | "ne", value });
        }
        break;
      }
      case "boolean": {
        const value = toBoolean(f.value);
        if (value === null) { details.push(`${field}: expected true/false`); continue; }
        filters.push({ field, type: "boolean", op: "eq", value });
        break;
      }
      case "owner": {
        const value = cleanString(f.value);
        if (!value) { details.push(`${field}: expected 'me' or a name`); continue; }
        filters.push({ field, type: "owner", op: f.op as "eq" | "ne", value: value.toLowerCase() === "me" ? "me" : value });
        break;
      }
      case "tags": {
        if (f.op === "in") {
          const values = (f.values ?? []).map(cleanString).filter((s): s is string => !!s).slice(0, MAX_VALUES);
          if (!values.length) { details.push(`${field}: "in" needs values`); continue; }
          filters.push({ field, type: "tags", op: "in", values });
        } else {
          const value = cleanString(f.value);
          if (!value) { details.push(`${field}: missing tag`); continue; }
          filters.push({ field, type: "tags", op: "contains", value });
        }
        break;
      }
    }
  }

  if (details.length) {
    return { ok: false, code: "invalid", reason: "Some parts of the generated query were not allowed.", details };
  }

  let sort: ValidatedNlQuery["sort"] = null;
  if (q.sort) {
    const spec = fields[q.sort.field];
    if (!spec || !spec.sortable) {
      return { ok: false, code: "invalid", reason: `Cannot sort by "${q.sort.field}".`, details: [] };
    }
    sort = { field: q.sort.field, direction: q.sort.direction };
  }

  let limit = NL_LIMIT_DEFAULT;
  if (typeof q.limit === "number" && Number.isFinite(q.limit)) {
    if (q.limit < 1) return { ok: false, code: "invalid", reason: "Limit must be at least 1.", details: [] };
    if (q.limit > NL_LIMIT_MAX) return { ok: false, code: "invalid", reason: `Limit exceeds the maximum of ${NL_LIMIT_MAX}.`, details: [] };
    limit = Math.floor(q.limit);
  }

  return {
    ok: true,
    query: {
      entity: q.entity,
      filters,
      sort,
      limit,
      explanation: q.explanation.trim().slice(0, 300),
    },
  };
}

/** YYYY-MM-DD in local time (toISOString would shift local midnight to the previous UTC day). */
export function formatLocalDate(d: Date | string): string {
  const date = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Human-readable rendering of a validated filter (used by the UI to show what ran). */
export function describeFilter(f: ValidatedFilter): string {
  const fmt = formatLocalDate;
  switch (f.type) {
    case "date":
      if ("range" in f) return `${f.field} ${f.op === "eq" ? "on" : "between"} ${fmt(f.range.start)} and ${fmt(f.range.end)}`;
      return `${f.field} ${f.op} ${fmt(f.value)}`;
    case "number":
      return f.op === "between" ? `${f.field} between ${f.value} and ${f.value2}` : `${f.field} ${f.op} ${f.value}`;
    default:
      if ("values" in f) return `${f.field} ${f.op} [${f.values.join(", ")}]`;
      return `${f.field} ${f.op} ${String(f.value)}`;
  }
}
