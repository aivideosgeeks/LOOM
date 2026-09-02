import { AiUnavailableError, type LlmProvider, type StructuredRequest, type StructuredResponse } from "./types";

/**
 * Used when no ANTHROPIC_API_KEY is configured. It never fabricates model output;
 * it reports "not configured" so every feature exercises its deterministic fallback
 * (lexicon sentiment, template emails, rule-based risk reasons, ...).
 */
export class StubProvider implements LlmProvider {
  readonly name = "stub" as const;
  readonly model = "none";
  readonly configured = false;

  async generateStructured<T>(_req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    throw new AiUnavailableError("not_configured", "No AI provider configured (set ANTHROPIC_API_KEY).", false);
  }
}
