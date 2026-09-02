import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { AnthropicProvider } from "./anthropic";
import { OpenAiCompatibleProvider } from "./openaiCompatible";
import { StubProvider } from "./stub";
import type { LlmProvider } from "./types";

let provider: LlmProvider | null = null;

const OPENROUTER_URL = "https://openrouter.ai/api/v1";
const GROQ_URL = "https://api.groq.com/openai/v1";

/**
 * Picks the language model gateway.
 *
 * `AI_PROVIDER=auto` (the default) takes the first one that has a key, preferring
 * Anthropic, then OpenRouter, then Groq, then any custom OpenAI-compatible endpoint.
 * Naming a provider explicitly makes the choice deterministic, which is what you want
 * in a deployment. With no key at all, every feature runs its deterministic fallback.
 */
function build(): LlmProvider {
  const choice = env.AI_PROVIDER;

  if (choice === "none") return new StubProvider();

  const wantAnthropic = choice === "anthropic" || (choice === "auto" && env.ANTHROPIC_API_KEY);
  if (wantAnthropic && env.ANTHROPIC_API_KEY) {
    return new AnthropicProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL);
  }

  const wantOpenRouter = choice === "openrouter" || (choice === "auto" && env.OPENROUTER_API_KEY);
  if (wantOpenRouter && env.OPENROUTER_API_KEY) {
    return new OpenAiCompatibleProvider(env.OPENROUTER_MODEL, env.OPENROUTER_API_KEY, OPENROUTER_URL, "openrouter", env.WEB_ORIGIN);
  }

  const wantGroq = choice === "groq" || (choice === "auto" && env.GROQ_API_KEY);
  if (wantGroq && env.GROQ_API_KEY) {
    return new OpenAiCompatibleProvider(env.GROQ_MODEL, env.GROQ_API_KEY, GROQ_URL, "groq");
  }

  const wantCustom = choice === "custom" || (choice === "auto" && env.AI_BASE_URL);
  if (wantCustom && env.AI_BASE_URL) {
    return new OpenAiCompatibleProvider(env.AI_MODEL ?? "gpt-4o-mini", env.AI_API_KEY ?? "", env.AI_BASE_URL, "custom");
  }

  return new StubProvider();
}

export function getProvider(): LlmProvider {
  if (!provider) {
    provider = build();
    if (provider.configured) {
      logger.info({ provider: provider.label ?? provider.name, model: provider.model }, "AI provider selected");
    } else {
      logger.warn(
        "No AI key configured: features run in fallback mode. Set ANTHROPIC_API_KEY, OPENROUTER_API_KEY or GROQ_API_KEY.",
      );
    }
  }
  return provider;
}

/** Test hook: swap the provider (e.g. for a fake that returns canned structured output). */
export function setProvider(p: LlmProvider | null) {
  provider = p;
}

export * from "./types";
