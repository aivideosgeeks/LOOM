import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callStructured, circuit } from "../ai/gateway";
import { AiUnavailableError, setProvider, type LlmProvider, type StructuredRequest, type StructuredResponse } from "../ai/provider";
import { AiCache, AiUsage } from "../models";
import { setupTestContext, teardownTestContext, type TestContext } from "./helpers";

const schema = z.object({ answer: z.string() });

class FakeProvider implements LlmProvider {
  readonly name = "anthropic" as const;
  readonly model = "claude-opus-5";
  readonly configured = true;
  calls = 0;
  mode: "ok" | "timeout" | "refuse" | "garbage" = "ok";
  async generateStructured<T>(_req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    this.calls += 1;
    const usage = { model: this.model, inputTokens: 120, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 };
    if (this.mode === "timeout") throw new AiUnavailableError("timeout", "timed out");
    if (this.mode === "refuse") return { refused: true, message: "declined", usage };
    if (this.mode === "garbage") return { refused: false, data: { nope: 1 } as unknown as T, usage };
    return { refused: false, data: { answer: "42" } as unknown as T, usage };
  }
}

let ctx: TestContext;
const fake = new FakeProvider();

beforeAll(async () => {
  ctx = await setupTestContext();
  setProvider(fake);
  circuit.reset();
});

afterAll(async () => {
  setProvider(null);
  circuit.reset();
  await teardownTestContext(ctx);
});

describe("AI gateway", () => {
  it("returns structured data, logs token usage with an estimated cost, and caches by key", async () => {
    const opts = { feature: "sentiment" as const, schema, system: "sys", user: "hello", cache: { key: "k1", ttlMs: 60_000 } };
    const first = await callStructured(opts);
    expect(first).toMatchObject({ ok: true, cached: false, data: { answer: "42" } });
    const second = await callStructured(opts);
    expect(second).toMatchObject({ ok: true, cached: true });
    expect(fake.calls).toBe(1);

    const rows = await AiUsage.find({ feature: "sentiment" }).sort({ createdAt: 1 }).lean();
    expect(rows.map((r) => r.status)).toEqual(["ok", "cached"]);
    expect(rows[0].inputTokens).toBe(120);
    expect(rows[0].estCostUsd).toBeCloseTo((120 * 5 + 30 * 25) / 1_000_000, 8);
    expect(await AiCache.countDocuments()).toBe(1);
  });

  it("never throws: timeouts become a fallback result and trip the circuit breaker", async () => {
    fake.mode = "timeout";
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await callStructured({ feature: "email_draft", schema, system: "s", user: `u${i}` }));
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(results[0]).toMatchObject({ ok: false, reason: "timeout" });
    expect(circuit.state()).toBe("open");

    const callsBefore = fake.calls;
    const shortCircuited = await callStructured({ feature: "email_draft", schema, system: "s", user: "again" });
    expect(shortCircuited).toMatchObject({ ok: false, reason: "circuit_open" });
    expect(fake.calls).toBe(callsBefore);
    circuit.reset();
    fake.mode = "ok";
  });

  it("surfaces refusals and schema mismatches as non-fatal results", async () => {
    fake.mode = "refuse";
    expect(await callStructured({ feature: "nl_query", schema, system: "s", user: "r" })).toMatchObject({ ok: false, reason: "refused" });
    fake.mode = "garbage";
    expect(await callStructured({ feature: "nl_query", schema, system: "s", user: "g" })).toMatchObject({ ok: false, reason: "invalid_output" });
    fake.mode = "ok";
    expect(circuit.state()).toBe("closed");
  });
});
