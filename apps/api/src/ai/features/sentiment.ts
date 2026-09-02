import { z } from "zod";
import type { Sentiment, SentimentLabel } from "@loom/shared";
import { sha256 } from "../../lib/hash";
import { callStructured } from "../gateway";
import { SENTIMENT_SYSTEM } from "../prompts";
import { sanitizeText, wrapData } from "../sanitize";

export const sentimentSchema = z.object({
  score: z.number(),
  label: z.enum(["positive", "neutral", "negative"]),
  rationale: z.string(),
});

const DAY_MS = 86_400_000;

export function labelFor(score: number): SentimentLabel {
  if (score >= 0.2) return "positive";
  if (score <= -0.2) return "negative";
  return "neutral";
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Tiny lexicon model used when the LLM is unavailable so scoring still has a sentiment input.
 * Deliberately conservative: scores rarely exceed ±0.6.
 */
const PHRASES: Array<[string, number]> = [
  ["budget approved", 0.8], ["green light", 0.8], ["moving forward", 0.6], ["go ahead", 0.6], ["on board", 0.5],
  ["ready to sign", 0.9], ["signed", 0.7], ["very interested", 0.7], ["looking forward", 0.4], ["next steps agreed", 0.5],
  ["budget cut", -0.8], ["budget freeze", -0.8], ["no budget", -0.8], ["too expensive", -0.7], ["pricing pushback", -0.6],
  ["went with a competitor", -1], ["chose a competitor", -1], ["not interested", -0.9], ["no longer interested", -0.9],
  ["put on hold", -0.6], ["on hold", -0.5], ["pushed back", -0.4], ["went dark", -0.6], ["no response", -0.4], ["not a priority", -0.6],
  ["lost the deal", -1], ["cancelled", -0.7], ["canceled", -0.7], ["unresponsive", -0.5], ["ghosted", -0.7],
];

const WORDS: Record<string, number> = {
  great: 0.5, excited: 0.6, love: 0.5, loved: 0.5, interested: 0.4, agreed: 0.4, approved: 0.6, perfect: 0.5, happy: 0.4,
  keen: 0.4, ready: 0.3, champion: 0.4, thrilled: 0.7, promising: 0.4, confirmed: 0.4, positive: 0.4, enthusiastic: 0.6,
  yes: 0.2, impressed: 0.5, valuable: 0.3, aligned: 0.3, momentum: 0.4, win: 0.4, won: 0.6,
  concern: -0.4, concerned: -0.4, concerns: -0.4, expensive: -0.5, pricey: -0.5, pushback: -0.5, objection: -0.4, objections: -0.4,
  delay: -0.4, delayed: -0.4, postpone: -0.5, postponed: -0.5, competitor: -0.3, churn: -0.5, cancel: -0.5, unhappy: -0.6,
  frustrated: -0.6, disappointed: -0.6, stalled: -0.5, silent: -0.3, declined: -0.6, rejected: -0.7, risk: -0.3, worried: -0.4,
  hesitant: -0.4, unsure: -0.3, cheaper: -0.3, costly: -0.4, lost: -0.6, skeptical: -0.4, doubts: -0.4, blocker: -0.4, blocked: -0.4,
  slow: -0.2, escalate: -0.3, complaint: -0.5, angry: -0.6, dissatisfied: -0.6,
};

const NEGATORS = new Set(["not", "no", "never", "without", "hardly", "isnt", "isn't", "dont", "don't", "wasnt", "wasn't", "cant", "can't"]);

export function lexiconSentiment(text: string): Sentiment {
  let lower = text.toLowerCase();
  let total = 0;
  let hits = 0;
  for (const [phrase, weight] of PHRASES) {
    if (lower.includes(phrase)) {
      total += weight;
      hits += 1;
      lower = lower.split(phrase).join(" ");
    }
  }
  const tokens = lower.replace(/[^a-z'\s]/g, " ").split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    const w = WORDS[tokens[i]];
    if (w === undefined) continue;
    const negated = i > 0 && NEGATORS.has(tokens[i - 1]);
    total += negated ? -w : w;
    hits += 1;
  }
  const score = hits === 0 ? 0 : clamp(total / Math.sqrt(hits + 2), -1, 1);
  const rounded = Math.round(score * 100) / 100;
  return { score: rounded, label: labelFor(rounded), source: "lexicon", rationale: hits ? `Keyword-based estimate from ${hits} signal(s).` : "No sentiment signals found." };
}

export interface SentimentContext {
  userId?: string | null;
  ref?: { type: string; id: string } | null;
}

/** LLM sentiment with a 30-day cache keyed on the text; falls back to the lexicon model. */
export async function analyzeSentiment(text: string, ctx: SentimentContext = {}): Promise<Sentiment> {
  const clean = sanitizeText(text, 6000);
  if (clean.length < 3) return { score: 0, label: "neutral", source: "lexicon", rationale: "Too short to assess." };

  const result = await callStructured({
    feature: "sentiment",
    schema: sentimentSchema,
    system: SENTIMENT_SYSTEM,
    user: wrapData("note", clean, {}, 6000),
    effort: "low",
    maxTokens: 2048,
    timeoutMs: 25_000,
    cache: { key: sha256(clean), ttlMs: 30 * DAY_MS },
    userId: ctx.userId ?? null,
    ref: ctx.ref ?? null,
  });

  if (result.ok) {
    const score = clamp(Number(result.data.score) || 0, -1, 1);
    const rounded = Math.round(score * 100) / 100;
    return { score: rounded, label: labelFor(rounded), source: "ai", rationale: sanitizeText(result.data.rationale, 300) };
  }
  return lexiconSentiment(clean);
}
