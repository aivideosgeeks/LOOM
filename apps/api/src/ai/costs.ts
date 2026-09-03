/** USD per million tokens. Cache reads are 10% of input, cache writes 125% of input unless listed. */
interface ModelPrice {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/**
 * Models whose price is zero: OpenRouter's `:free` tier, and Groq's free
 * developer tier. Matched by pattern so new free models are covered automatically.
 */
const FREE_MODEL_PATTERNS = [/:free$/i, /^groq\//i];

const PRICES: Record<string, ModelPrice> = {
  // OpenRouter paid passthroughs, priced per their published rates.
  "deepseek/deepseek-chat-v3.1": { input: 0.25, output: 0.85 },
  "google/gemini-2.0-flash-001": { input: 0.1, output: 0.4 },
  "meta-llama/llama-3.3-70b-instruct": { input: 0.12, output: 0.3 },
  // Groq charges per token on its paid tier; the free tier is rate-limited, not billed.
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "llama-3.1-8b-instant": { input: 0.05, output: 0.08 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  // OpenAI, per published rates after the July 2026 cut. An id not listed here
  // reports as free rather than guessed at, so add yours if the cost column
  // reads zero.
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4o": { input: 2.5, output: 10 },
};

const EMBEDDING_PRICES: Record<string, number> = {
  "voyage-3.5-lite": 0.02,
  "voyage-3.5": 0.06,
  "voyage-3-lite": 0.02,
  "voyage-3": 0.06,
  "text-embedding-3-small": 0.02,
  "text-embedding-3-large": 0.13,
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function estimateCostUsd(model: string, usage: TokenUsage): number {
  if (FREE_MODEL_PATTERNS.some((re) => re.test(model))) return 0;
  const price = PRICES[model];
  // An unknown model is reported as free rather than guessed at, so the cost column
  // never invents a number. Add it to PRICES above to see real spend.
  if (!price) return 0;
  const cacheRead = price.cacheRead ?? price.input * 0.1;
  const cacheWrite = price.cacheWrite ?? price.input * 1.25;
  const cost =
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * cacheRead +
      usage.cacheWriteTokens * cacheWrite) /
    1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}

export function estimateEmbeddingCostUsd(model: string, tokens: number): number {
  const perM = EMBEDDING_PRICES[model] ?? 0;
  return Math.round(((tokens * perM) / 1_000_000) * 1e6) / 1e6;
}
