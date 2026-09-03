import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { FallbackProvider } from "../ai/provider/fallback";
import { AiUnavailableError, type LlmProvider, type StructuredResponse } from "../ai/provider/types";

const request = {
  schema: z.object({ ok: z.boolean() }),
  system: "s",
  user: "u",
  effort: "low" as const,
  maxTokens: 64,
  timeoutMs: 1_000,
};

const usage = { model: "m", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** A provider that either answers, refuses, or throws, and records that it was asked. */
function fake(
  label: string,
  behaviour: { answer?: unknown; refuse?: string; throws?: Error; configured?: boolean },
): LlmProvider & { calls: number } {
  const p = {
    name: "openai-compatible" as const,
    label,
    model: `${label}-model`,
    configured: behaviour.configured ?? true,
    calls: 0,
    async generateStructured<T>(): Promise<StructuredResponse<T>> {
      p.calls += 1;
      if (behaviour.throws) throw behaviour.throws;
      if (behaviour.refuse) return { refused: true, message: behaviour.refuse, usage };
      return { refused: false, data: behaviour.answer as T, usage };
    },
  };
  return p;
}

describe("provider failover", () => {
  it("uses the second provider when the first is unreachable", async () => {
    const first = fake("openrouter", { throws: new AiUnavailableError("provider_error", "model retired") });
    const second = fake("groq", { answer: { ok: true } });

    const result = await new FallbackProvider([first, second]).generateStructured(request);

    expect(result).toMatchObject({ refused: false, data: { ok: true } });
    expect(second.calls).toBe(1);
  });

  it("fails over on a rate limit, which is the common free-tier failure", async () => {
    const first = fake("openrouter", { throws: new AiUnavailableError("provider_error", "rate limit reached") });
    const second = fake("groq", { answer: { ok: true } });

    await expect(new FallbackProvider([first, second]).generateStructured(request)).resolves.toMatchObject({
      refused: false,
    });
  });

  it("does not consult the second provider when the first answers", async () => {
    const first = fake("openrouter", { answer: { ok: true } });
    const second = fake("groq", { answer: { ok: false } });

    await new FallbackProvider([first, second]).generateStructured(request);

    expect(first.calls).toBe(1);
    expect(second.calls).toBe(0);
  });

  it("treats a refusal as an answer rather than shopping for a permissive one", async () => {
    const first = fake("openrouter", { refuse: "I cannot help with that" });
    const second = fake("groq", { answer: { ok: true } });

    const result = await new FallbackProvider([first, second]).generateStructured(request);

    expect(result).toMatchObject({ refused: true });
    expect(second.calls).toBe(0);
  });

  it("skips providers that have no key", async () => {
    const unconfigured = fake("anthropic", { answer: { ok: false }, configured: false });
    const configured = fake("groq", { answer: { ok: true } });

    const result = await new FallbackProvider([unconfigured, configured]).generateStructured(request);

    expect(unconfigured.calls).toBe(0);
    expect(result).toMatchObject({ refused: false, data: { ok: true } });
  });

  it("surfaces the last error when every provider fails", async () => {
    const first = fake("openrouter", { throws: new AiUnavailableError("provider_error", "first down") });
    const second = fake("groq", { throws: new AiUnavailableError("timeout", "second timed out") });

    await expect(new FallbackProvider([first, second]).generateStructured(request)).rejects.toThrow("second timed out");
  });

  it("reports the provider that actually answered, so usage rows are not misattributed", async () => {
    const first = fake("openrouter", { throws: new AiUnavailableError("provider_error", "down") });
    const second = fake("groq", { answer: { ok: true } });
    const chain = new FallbackProvider([first, second]);

    expect(chain.label).toContain("openrouter");
    await chain.generateStructured(request);

    expect(chain.label).toContain("groq");
    expect(chain.model).toBe("groq-model");
  });

  it("is configured when any provider in the chain is", () => {
    const chain = new FallbackProvider([
      fake("anthropic", { answer: {}, configured: false }),
      fake("groq", { answer: {} }),
    ]);
    expect(chain.configured).toBe(true);
  });
});
