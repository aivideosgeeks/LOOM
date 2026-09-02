import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { formatLocalDate, NL_LIMIT_MAX, resolveDateToken, validateNlQuery } from "@loom/shared";
import { compileNlQuery, heuristicTranslate, type CompileResolvers } from "../ai/features/nlQuery";

const now = new Date("2026-09-02T10:00:00");
const day = (d: Date | null | undefined) => (d ? formatLocalDate(d) : null);
const filter = (field: string, op: string, value: unknown = null, value2: unknown = null, values: string[] | null = null) => ({ field, op, value, value2, values });
const query = (entity: "deals" | "contacts", filters: unknown[], extra: Record<string, unknown> = {}) => ({
  kind: "query",
  entity,
  filters,
  sort: null,
  limit: null,
  explanation: "test",
  reason: null,
  ...extra,
});

const resolvers: CompileResolvers = {
  async userIdsByName(name) {
    return name.toLowerCase().includes("alice") ? [new Types.ObjectId("aaaaaaaaaaaaaaaaaaaaaaaa")] : [];
  },
  async contactIdsWhere() {
    return [new Types.ObjectId("bbbbbbbbbbbbbbbbbbbbbbbb")];
  },
};
const admin = { id: "cccccccccccccccccccccccc", name: "Admin", email: "a@x.dev", role: "admin" as const };
const member = { id: "dddddddddddddddddddddddd", name: "Member", email: "m@x.dev", role: "member" as const };

describe("NL query validation (accepts real questions)", () => {
  it('"deals over $10k closing this month"', () => {
    const v = validateNlQuery(query("deals", [filter("value", "gt", 10000), filter("expectedCloseDate", "between", "start_of_month", "end_of_month")]), { now });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.query.filters).toHaveLength(2);
    const date = v.query.filters[1];
    expect(date.type).toBe("date");
    if (date.type === "date" && date.op === "between") {
      expect(day(date.range.start)).toBe("2026-09-01");
      expect(day(date.range.end)).toBe("2026-09-30");
    }
  });

  it('"contacts not touched in 30 days"', () => {
    const v = validateNlQuery(query("contacts", [filter("lastActivityAt", "before", "-30d")]), { now });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const f = v.query.filters[0];
    if (f.type === "date" && f.op === "before") {
      expect(day(f.value)).toBe("2026-08-03");
    } else throw new Error("expected before filter");
  });

  it('"my at-risk deals, biggest first" with sort and limit', () => {
    const v = validateNlQuery(query("deals", [filter("owner", "eq", "me"), filter("atRisk", "eq", "true")], { sort: { field: "value", direction: "desc" }, limit: 25 }), { now });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.query.sort).toEqual({ field: "value", direction: "desc" });
    expect(v.query.limit).toBe(25);
    expect(v.query.filters[1]).toMatchObject({ type: "boolean", value: true });
  });

  it('"enterprise-tagged contacts at Acme" (tags + contains)', () => {
    const v = validateNlQuery(query("contacts", [filter("company", "contains", "Acme"), filter("tags", "contains", "enterprise")]), { now });
    expect(v.ok).toBe(true);
  });

  it('"hot deals in proposal or negotiation" (stage in + score gte, money strings)', () => {
    const v = validateNlQuery(query("deals", [filter("stage", "in", null, null, ["proposal", "NEGOTIATION"]), filter("score", "gte", "70"), filter("value", "between", "$5k", "50,000")]), { now });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.query.filters[0]).toMatchObject({ type: "stage", values: ["Proposal", "Negotiation"] });
    expect(v.query.filters[1]).toMatchObject({ type: "number", value: 70 });
    expect(v.query.filters[2]).toMatchObject({ type: "number", value: 5000, value2: 50000 });
  });
});

describe("NL query validation (rejects unsafe or out-of-scope output)", () => {
  it("rejects unsupported requests (writes, unrelated questions)", () => {
    const v = validateNlQuery({ kind: "unsupported", entity: null, filters: [], sort: null, limit: null, explanation: "", reason: "Deleting records is not supported." });
    expect(v).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("rejects fields outside the allowlist", () => {
    const v = validateNlQuery(query("deals", [filter("passwordHash", "eq", "x")]));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.details.join(" ")).toMatch(/Unknown field/);
  });

  it("rejects operators that do not fit the field type", () => {
    const v = validateNlQuery(query("deals", [filter("stage", "gt", "Lead")]));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.details.join(" ")).toMatch(/not allowed/);
  });

  it("rejects Mongo operator injection via $-prefixed keys anywhere in the payload", () => {
    const v = validateNlQuery({ ...query("deals", [{ field: "value", op: "gt", value: { $gt: "" }, value2: null, values: null }]) });
    expect(v).toMatchObject({ ok: false, code: "invalid" });
    const v2 = validateNlQuery({ ...query("deals", []), $where: "sleep(1000)" });
    expect(v2.ok).toBe(false);
  });

  it("rejects limits above the cap and unparseable dates", () => {
    expect(validateNlQuery(query("deals", [], { limit: NL_LIMIT_MAX + 1 })).ok).toBe(false);
    expect(validateNlQuery(query("deals", [filter("createdAt", "after", "sometime last spring")])).ok).toBe(false);
  });

  it("rejects sorting on non-sortable fields and malformed structures", () => {
    expect(validateNlQuery(query("deals", [], { sort: { field: "atRisk", direction: "asc" } })).ok).toBe(false);
    expect(validateNlQuery({ kind: "query", entity: "invoices" }).ok).toBe(false);
    expect(validateNlQuery("drop table deals").ok).toBe(false);
  });
});

describe("NL query compilation", () => {
  it("always scopes members to their own records even if they ask for someone else's", async () => {
    const v = validateNlQuery(query("deals", [filter("owner", "eq", "Alice")]), { now });
    if (!v.ok) throw new Error("expected ok");
    const compiled = await compileNlQuery(v.query, member, resolvers);
    expect(compiled.scopedToOwn).toBe(true);
    const clauses = (compiled.filter as { $and: Record<string, unknown>[] }).$and;
    expect(clauses).toContainEqual({ owner: new Types.ObjectId(member.id) });
  });

  it("builds read-only filters with escaped regexes and resolved owners for admins", async () => {
    const v = validateNlQuery(query("deals", [filter("owner", "eq", "Alice"), filter("title", "contains", "a.b*"), filter("company", "eq", "Acme")], { sort: { field: "score", direction: "desc" } }), { now });
    if (!v.ok) throw new Error("expected ok");
    const compiled = await compileNlQuery(v.query, admin, resolvers);
    expect(compiled.scopedToOwn).toBe(false);
    const clauses = (compiled.filter as { $and: Record<string, unknown>[] }).$and;
    expect(clauses[0]).toEqual({ owner: { $in: [new Types.ObjectId("aaaaaaaaaaaaaaaaaaaaaaaa")] } });
    expect((clauses[1] as { title: RegExp }).title.source).toBe("a\\.b\\*");
    expect(clauses[2]).toEqual({ contact: { $in: [new Types.ObjectId("bbbbbbbbbbbbbbbbbbbbbbbb")] } });
    expect(compiled.sort).toEqual({ score: -1 });
    expect(JSON.stringify(compiled.filter)).not.toMatch(/\$where|\$function|\$expr/);
  });
});

describe("relative date grammar", () => {
  it("resolves tokens and offsets relative to now", () => {
    expect(day(resolveDateToken("today", now))).toBe("2026-09-02");
    expect(day(resolveDateToken("-7d", now))).toBe("2026-08-26");
    expect(day(resolveDateToken("+2w", now))).toBe("2026-09-16");
    expect(day(resolveDateToken("start_of_quarter", now))).toBe("2026-07-01");
    expect(day(resolveDateToken("end_of_quarter", now))).toBe("2026-09-30");
    expect(day(resolveDateToken("2026-01-15", now))).toBe("2026-01-15");
    expect(resolveDateToken("next tuesday", now)).toBeNull();
  });
});

describe("heuristic fallback translator", () => {
  it("covers the common questions when the LLM is unavailable", () => {
    const q = heuristicTranslate("show me my deals over $10k closing this month");
    expect(q?.entity).toBe("deals");
    expect(q?.filters).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "value", op: "gt", value: 10000 }), expect.objectContaining({ field: "expectedCloseDate", op: "between" }), expect.objectContaining({ field: "owner", value: "me" })]),
    );
    expect(heuristicTranslate("which contacts haven't been touched in 30 days")?.filters[0]).toMatchObject({ field: "lastActivityAt", op: "before", value: "-30d" });
    expect(heuristicTranslate("delete all deals")).toBeNull();
    expect(heuristicTranslate("what is the meaning of life")).toBeNull();
  });
});
