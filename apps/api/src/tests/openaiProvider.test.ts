/**
 * The OpenAI-compatible provider, which covers OpenRouter, Groq and any other
 * gateway speaking the same wire format. `fetch` is stubbed so the tests are
 * deterministic and never touch the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { extractJson, OpenAiCompatibleProvider } from "../ai/provider/openaiCompatible";
import { AiUnavailableError } from "../ai/provider/types";

const schema = z.object({ label: z.enum(["positive", "negative"]), score: z.number() });

const request = {
  schema,
  system: "Classify the sentiment.",
  user: "They approved the budget.",
  effort: "low" as const,
  maxTokens: 512,
  timeoutMs: 5_000,
};

function reply(content: string, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      model: "test-model",
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 40, completion_tokens: 12 },
      ...extra,
    }),
    text: async () => content,
  } as unknown as Response;
}

function failure(status: number, body: string) {
  return { ok: false, status, text: async () => body, json: async () => ({}) } as unknown as Response;
}

let calls: Array<{ url: string; body: any; headers: Record<string, string> }>;

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(handler: (call: { url: string; body: any }) => Response) {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, body, headers: init.headers as Record<string, string> });
    return handler({ url, body });
  });
}

const provider = () => new OpenAiCompatibleProvider("test-model", "key-123", "https://gateway.test/v1", "openrouter", "https://loom.test");

describe("OpenAI-compatible provider", () => {
  it("asks for a strict JSON schema and returns the parsed result", async () => {
    stubFetch(() => reply(JSON.stringify({ label: "positive", score: 0.8 })));
    const res = await provider().generateStructured(request);

    expect(res.refused).toBe(false);
    if (res.refused) return;
    expect(res.data).toEqual({ label: "positive", score: 0.8 });
    expect(res.usage).toMatchObject({ model: "test-model", inputTokens: 40, outputTokens: 12 });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://gateway.test/v1/chat/completions");
    expect(calls[0].headers.authorization).toBe("Bearer key-123");
    expect(calls[0].body.response_format.type).toBe("json_schema");
    expect(calls[0].body.response_format.json_schema.schema.properties).toHaveProperty("label");
    expect(calls[0].body.messages[0].role).toBe("system");
  });

  it("identifies itself to OpenRouter but not to gateways that do not want it", async () => {
    stubFetch(() => reply(JSON.stringify({ label: "positive", score: 1 })));
    await provider().generateStructured(request);
    expect(calls[0].headers["HTTP-Referer"]).toBe("https://loom.test");

    calls = [];
    await new OpenAiCompatibleProvider("m", "k", "https://groq.test/v1", "groq").generateStructured(request);
    expect(calls[0].headers["HTTP-Referer"]).toBeUndefined();
  });

  it("falls back to json_object when the model cannot do json_schema", async () => {
    stubFetch(({ body }) => {
      if (body.response_format?.type === "json_schema") return failure(400, "response_format json_schema is not supported for this model");
      return reply(JSON.stringify({ label: "negative", score: -0.4 }));
    });

    const res = await provider().generateStructured(request);
    expect(res.refused).toBe(false);
    if (res.refused) return;
    expect(res.data.label).toBe("negative");

    expect(calls).toHaveLength(2);
    expect(calls[1].body.response_format.type).toBe("json_object");
    // The schema has to reach the model somehow once the structured flag is gone.
    expect(calls[1].body.messages[0].content).toContain("JSON Schema");
  });

  it("falls back again to plain text when json_object is refused too", async () => {
    stubFetch(({ body }) => {
      if (body.response_format) return failure(400, "response_format is not supported");
      return reply("Here you go:\n```json\n{ \"label\": \"positive\", \"score\": 0.2 }\n```");
    });

    const res = await provider().generateStructured(request);
    expect(res.refused).toBe(false);
    if (res.refused) return;
    expect(res.data.score).toBe(0.2);
    expect(calls).toHaveLength(3);
    expect(calls[2].body.response_format).toBeUndefined();
  });

  it("rejects output that does not match the schema instead of passing it on", async () => {
    stubFetch(() => reply(JSON.stringify({ label: "sideways", score: "high" })));
    await expect(provider().generateStructured(request)).rejects.toMatchObject({ reason: "invalid_output" });
  });

  it("treats a content filter as a refusal, not a failure", async () => {
    stubFetch(() => reply("", { choices: [{ message: { content: "" }, finish_reason: "content_filter" }] }));
    const res = await provider().generateStructured(request);
    expect(res.refused).toBe(true);
  });

  it("treats a truncated response as invalid output", async () => {
    stubFetch(() => reply('{"label":"pos', { choices: [{ message: { content: '{"label":"pos' }, finish_reason: "length" }] }));
    await expect(provider().generateStructured(request)).rejects.toMatchObject({ reason: "invalid_output" });
  });

  it("maps auth, rate limit and outage responses to useful errors", async () => {
    stubFetch(() => failure(401, "invalid api key"));
    await expect(provider().generateStructured(request)).rejects.toThrow(/rejected the API key/i);

    stubFetch(() => failure(429, "slow down"));
    await expect(provider().generateStructured(request)).rejects.toThrow(/rate limit/i);

    stubFetch(() => failure(503, "upstream down"));
    await expect(provider().generateStructured(request)).rejects.toThrow(/503/);
  });

  it("does not trip the circuit breaker for a malformed request of our own", async () => {
    stubFetch(() => failure(400, "model 'nope' does not exist"));
    await provider()
      .generateStructured(request)
      .catch((e: AiUnavailableError) => {
        expect(e.countsAsFailure).toBe(false);
      });
    expect.assertions(1);
  });

  it("reports a timeout rather than hanging", async () => {
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    await expect(provider().generateStructured({ ...request, timeoutMs: 30 })).rejects.toMatchObject({ reason: "timeout" });
  });
});

describe("JSON extraction from untidy model output", () => {
  it("reads clean JSON, fenced JSON and JSON buried in prose", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! Here is the result: {"a":1} Hope that helps.')).toEqual({ a: 1 });
  });

  it("handles braces inside strings without stopping early", () => {
    expect(extractJson('Result: {"note":"uses { and } inside","a":2} done')).toEqual({ note: "uses { and } inside", a: 2 });
    expect(extractJson('{"note":"escaped \\" quote","a":3}')).toEqual({ note: 'escaped " quote', a: 3 });
  });

  it("returns undefined when there is no JSON at all", () => {
    expect(extractJson("I am afraid I cannot do that.")).toBeUndefined();
    expect(extractJson("")).toBeUndefined();
  });
});
