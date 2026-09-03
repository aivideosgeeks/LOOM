import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { AnthropicProvider } from "./anthropic";
import { FallbackProvider } from "./fallback";
import { OpenAiCompatibleProvider } from "./openaiCompatible";
import { StubProvider } from "./stub";
import type { LlmProvider } from "./types";

let provider: LlmProvider | null = null;

const OPENAI_URL = "https://api.openai.com/v1";
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
function anthropic(): LlmProvider | null {
  return env.ANTHROPIC_API_KEY ? new AnthropicProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL) : null;
}
function openai(): LlmProvider | null {
  return env.OPENAI_API_KEY
    ? new OpenAiCompatibleProvider(env.OPENAI_MODEL, env.OPENAI_API_KEY, OPENAI_URL, "openai")
    : null;
}
function openrouter(): LlmProvider | null {
  return env.OPENROUTER_API_KEY
    ? new OpenAiCompatibleProvider(env.OPENROUTER_MODEL, env.OPENROUTER_API_KEY, OPENROUTER_URL, "openrouter", env.WEB_ORIGIN)
    : null;
}
function groq(): LlmProvider | null {
  return env.GROQ_API_KEY ? new OpenAiCompatibleProvider(env.GROQ_MODEL, env.GROQ_API_KEY, GROQ_URL, "groq") : null;
}
function custom(): LlmProvider | null {
  return env.AI_BASE_URL
    ? new OpenAiCompatibleProvider(env.AI_MODEL ?? "gpt-4o-mini", env.AI_API_KEY ?? "", env.AI_BASE_URL, "custom")
    : null;
}

function build(): LlmProvider {
  const choice = env.AI_PROVIDER;

  if (choice === "none") return new StubProvider();

  // Naming a provider pins it: a deployment that says groq should fail as groq
  // rather than quietly answer as something else.
  if (choice === "anthropic") return anthropic() ?? new StubProvider();
  if (choice === "openai") return openai() ?? new StubProvider();
  if (choice === "openrouter") return openrouter() ?? new StubProvider();
  if (choice === "groq") return groq() ?? new StubProvider();
  if (choice === "custom") return custom() ?? new StubProvider();

  // Auto: use every key present, best first. Free tiers retire models and run
  // out of daily allowance, and a second key answers perfectly well when the
  // first one does either.
  const chain = [anthropic(), openai(), openrouter(), groq(), custom()].filter((p): p is LlmProvider => p !== null);
  if (chain.length === 0) return new StubProvider();
  if (chain.length === 1) return chain[0]!;
  return new FallbackProvider(chain);
}

export function getProvider(): LlmProvider {
  if (!provider) {
    provider = build();
    if (provider.configured) {
      logger.info({ provider: provider.label ?? provider.name, model: provider.model }, "AI provider selected");
    } else {
      logger.warn(
        "No AI key configured: features run in fallback mode. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY or GROQ_API_KEY.",
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
