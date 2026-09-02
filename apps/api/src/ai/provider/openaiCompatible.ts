import { z } from "zod";
import { logger } from "../../lib/logger";
import { AiUnavailableError, type LlmProvider, type StructuredRequest, type StructuredResponse, type UsageInfo } from "./types";

/**
 * Any OpenAI-compatible chat completions endpoint: OpenRouter, Groq, Together,
 * a local Ollama, or OpenAI itself. All of them speak the same wire format, so one
 * provider covers the lot and the difference is a base URL, a key and a model id.
 *
 * Structured output is requested with `response_format: json_schema`. Not every model
 * on every gateway supports it, so a rejection falls back to `json_object` with the
 * schema described in the system prompt, and finally to plain text with the JSON
 * extracted. The gateway validates the result against the Zod schema either way, so a
 * model that ignores the shape fails closed into the feature's fallback rather than
 * returning something wrong.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = "openai-compatible" as const;
  readonly configured = true;

  constructor(
    readonly model: string,
    private apiKey: string,
    private baseUrl: string,
    /** Shown in logs and on the status pill, e.g. "openrouter" or "groq". */
    readonly label: string,
    private referer?: string,
  ) {}

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const jsonSchema = toJsonSchema(req.schema);

    // json_schema first; degrade only if the gateway says it cannot do it.
    let raw: { text: string; usage: UsageInfo; finish: string | null };
    try {
      raw = await this.call(req, { type: "json_schema", json_schema: { name: "result", strict: true, schema: jsonSchema } }, false);
    } catch (err) {
      if (!(err instanceof UnsupportedFormatError)) throw err;
      logger.debug({ model: this.model }, "Model rejected json_schema; retrying with json_object");
      try {
        raw = await this.call(req, { type: "json_object" }, true, jsonSchema);
      } catch (err2) {
        if (!(err2 instanceof UnsupportedFormatError)) throw err2;
        raw = await this.call(req, undefined, true, jsonSchema);
      }
    }

    if (raw.finish === "content_filter") {
      return { refused: true, message: "The model declined this request.", usage: raw.usage };
    }
    if (raw.finish === "length") {
      throw new AiUnavailableError("invalid_output", "Model output was truncated (token limit reached).", false);
    }

    const parsed = extractJson(raw.text);
    if (parsed === undefined) {
      throw new AiUnavailableError("invalid_output", "Model did not return usable JSON.", false);
    }
    const checked = req.schema.safeParse(parsed);
    if (!checked.success) {
      throw new AiUnavailableError("invalid_output", "Model output did not match the schema.", false);
    }
    return { refused: false, data: checked.data, usage: raw.usage };
  }

  private async call<T>(
    req: StructuredRequest<T>,
    responseFormat: unknown,
    describeSchema: boolean,
    jsonSchema?: unknown,
  ): Promise<{ text: string; usage: UsageInfo; finish: string | null }> {
    const system = describeSchema
      ? `${req.system}\n\nReply with a single JSON object and nothing else. It must match this JSON Schema exactly:\n${JSON.stringify(jsonSchema)}`
      : req.system;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
          // OpenRouter asks callers to identify themselves; harmless elsewhere.
          ...(this.referer ? { "HTTP-Referer": this.referer, "X-Title": "LOOM" } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: req.maxTokens,
          temperature: req.effort === "low" ? 0 : 0.3,
          messages: [
            { role: "system", content: system },
            { role: "user", content: req.user },
          ],
          ...(responseFormat ? { response_format: responseFormat } : {}),
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new AiUnavailableError("timeout", `${this.label} request timed out.`);
      }
      throw new AiUnavailableError("provider_error", `Could not reach ${this.label}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = (await res.text()).slice(0, 400);
      // A gateway that cannot honour the requested format says so with a 400.
      if (res.status === 400 && /response_format|json_schema|structured|schema/i.test(body)) {
        throw new UnsupportedFormatError(body);
      }
      if (res.status === 401 || res.status === 403) {
        throw new AiUnavailableError("provider_error", `${this.label} rejected the API key.`);
      }
      if (res.status === 429) {
        throw new AiUnavailableError("provider_error", `${this.label} rate limit reached.`);
      }
      if (res.status === 400) {
        // Our request was malformed: not an outage, so it must not trip the circuit.
        throw new AiUnavailableError("provider_error", `${this.label} rejected the request: ${body}`, false);
      }
      throw new AiUnavailableError("provider_error", `${this.label} error ${res.status}: ${body}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
      model?: string;
      error?: { message?: string };
    };
    if (json.error) throw new AiUnavailableError("provider_error", `${this.label}: ${json.error.message ?? "unknown error"}`);

    const choice = json.choices?.[0];
    return {
      text: choice?.message?.content ?? "",
      finish: choice?.finish_reason ?? null,
      usage: {
        model: json.model ?? this.model,
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
        cacheReadTokens: json.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        cacheWriteTokens: 0,
      },
    };
  }
}

class UnsupportedFormatError extends Error {}

function toJsonSchema(schema: unknown): unknown {
  try {
    return z.toJSONSchema(schema as z.ZodType, { target: "draft-7", io: "output" });
  } catch {
    return { type: "object" };
  }
}

/**
 * Models sometimes wrap JSON in prose or a fenced block even when asked not to.
 * Take the first balanced object rather than failing the whole call.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fall through
    }
  }
  const start = trimmed.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}
