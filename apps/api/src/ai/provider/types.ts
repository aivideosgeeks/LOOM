import type { ZodType } from "zod";
import type { TokenUsage } from "../costs";

export type Effort = "low" | "medium" | "high";

export interface StructuredRequest<T> {
  schema: ZodType<T>;
  system: string;
  user: string;
  effort: Effort;
  maxTokens: number;
  timeoutMs: number;
}

export interface UsageInfo extends TokenUsage {
  model: string;
}

export type StructuredResponse<T> =
  | { refused: false; data: T; usage: UsageInfo }
  | { refused: true; message: string; usage: UsageInfo };

export interface LlmProvider {
  readonly name: "anthropic" | "openai-compatible" | "stub";
  /** Human label for logs and the status pill, e.g. "openrouter". Defaults to the name. */
  readonly label?: string;
  readonly model: string;
  readonly configured: boolean;
  generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>>;
}

export class AiUnavailableError extends Error {
  constructor(
    public reason: "not_configured" | "timeout" | "provider_error" | "invalid_output",
    message: string,
    public countsAsFailure = true,
  ) {
    super(message);
  }
}
