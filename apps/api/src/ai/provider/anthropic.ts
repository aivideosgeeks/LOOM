import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { AiUnavailableError, type LlmProvider, type StructuredRequest, type StructuredResponse, type UsageInfo } from "./types";

/**
 * Claude provider. Every call:
 *  - uses structured outputs (output_config.format) so the response is schema-validated JSON,
 *  - runs with an explicit per-request timeout (ms) and a single retry,
 *  - marks the system prompt as a cache breakpoint (prompt caching for repeated feature prompts),
 *  - opts into server-side refusal fallbacks (can be disabled with AI_SERVER_FALLBACKS=false).
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic" as const;
  readonly model: string;
  readonly configured = true;
  private client: Anthropic;

  constructor(apiKey: string, model: string) {
    this.model = model;
    this.client = new Anthropic({ apiKey, timeout: env.AI_TIMEOUT_MS, maxRetries: 1 });
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    try {
      const message = await this.client.beta.messages.parse(
        {
          model: this.model,
          max_tokens: req.maxTokens,
          system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: req.user }],
          output_config: { format: zodOutputFormat(req.schema), effort: req.effort },
          ...(env.AI_SERVER_FALLBACKS ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
        },
        { timeout: req.timeoutMs },
      );

      const usage: UsageInfo = {
        model: message.model ?? this.model,
        inputTokens: message.usage?.input_tokens ?? 0,
        outputTokens: message.usage?.output_tokens ?? 0,
        cacheReadTokens: message.usage?.cache_read_input_tokens ?? 0,
        cacheWriteTokens: message.usage?.cache_creation_input_tokens ?? 0,
      };

      if (message.stop_reason === "refusal") {
        const explanation = message.stop_details && "explanation" in message.stop_details ? String(message.stop_details.explanation ?? "") : "";
        return { refused: true, message: explanation || "The model declined this request.", usage };
      }
      if (message.stop_reason === "max_tokens") {
        throw new AiUnavailableError("invalid_output", "Model output was truncated (max_tokens reached).", false);
      }
      if (message.parsed_output === null || message.parsed_output === undefined) {
        throw new AiUnavailableError("invalid_output", "Model returned output that did not match the schema.", false);
      }
      return { refused: false, data: message.parsed_output as T, usage };
    } catch (error) {
      if (error instanceof AiUnavailableError) throw error;
      throw classify(error);
    }
  }
}

function classify(error: unknown): AiUnavailableError {
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiUnavailableError("timeout", "Claude request timed out.");
  }
  if (error instanceof Anthropic.BadRequestError) {
    // Our request was malformed (schema/params). Not a provider outage: do not trip the circuit.
    logger.error({ err: error.message }, "Anthropic rejected request (400)");
    return new AiUnavailableError("provider_error", `Bad request to Claude: ${error.message}`, false);
  }
  if (error instanceof Anthropic.AuthenticationError) {
    logger.error("Anthropic authentication failed: check ANTHROPIC_API_KEY");
    return new AiUnavailableError("provider_error", "Claude authentication failed.");
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiUnavailableError("provider_error", "Claude rate limit reached.");
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiUnavailableError("provider_error", `Could not reach Claude: ${error.message}`);
  }
  if (error instanceof Anthropic.APIError) {
    return new AiUnavailableError("provider_error", `Claude API error ${error.status ?? ""}: ${error.message}`);
  }
  const msg = error instanceof Error ? error.message : String(error);
  return new AiUnavailableError("provider_error", msg);
}
