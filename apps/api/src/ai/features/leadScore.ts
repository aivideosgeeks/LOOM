import { ENGAGEMENT_KINDS, OPEN_STAGES, STAGE_STALL_THRESHOLD_DAYS, type ScoreBreakdown, type Stage } from "@loom/shared";
import { daysAgo, daysBetween } from "../../lib/dates";
import { sha256 } from "../../lib/hash";
import { logger } from "../../lib/logger";
import { Contact, Deal, Note } from "../../models";

/**
 * Lead scoring model.
 *
 * Deliberately a transparent, deterministic model rather than an opaque LLM guess:
 * every component is explainable in the UI, it is unit-testable, and it costs nothing
 * to recompute. The AI contribution is the per-note sentiment (Claude classifies every
 * note / call / meeting), which feeds the `sentiment` component below.
 *
 *   score = clamp( stagePrior + recency + value + velocity + sentiment + engagement, 0, 100 )
 *
 *   stagePrior  0..60   base close probability of the pipeline stage
 *   recency     0..12   how recently anyone touched the deal
 *   value       0..6    log-scaled deal size (bigger deals are usually better qualified)
 *   velocity  -15..6    time in current stage vs. the stage's stall threshold
 *   sentiment -12..12   recency-weighted average of note sentiment, plus a trend adjustment
 *   engagement  0..5    number of human touches in the last 30 days
 *
 * Weights are chosen so only an exceptional open deal reaches 100 and a cold, negative lead hits 0.
 *
 * Won is always 100, Lost always 0.
 */

export interface ScoreInputs {
  stage: Stage;
  value: number;
  daysSinceActivity: number;
  daysInStage: number;
  /** Most recent first, each in -1..1. */
  sentiments: number[];
  engagementCount30d: number;
  now?: Date;
}

export const STAGE_PRIOR: Record<Stage, number> = {
  Lead: 10,
  Contacted: 25,
  Proposal: 45,
  Negotiation: 60,
  Won: 100,
  Lost: 0,
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

export function recencyComponent(daysSinceActivity: number): number {
  if (daysSinceActivity <= 2) return 12;
  if (daysSinceActivity <= 7) return 10;
  if (daysSinceActivity <= 14) return 7;
  if (daysSinceActivity <= 30) return 4;
  if (daysSinceActivity <= 60) return 1;
  return 0;
}

export function valueComponent(value: number): number {
  if (!value || value <= 100) return 0;
  const lo = 2; // log10(100)
  const hi = Math.log10(500_000);
  return round1(6 * clamp((Math.log10(value) - lo) / (hi - lo), 0, 1));
}

export function velocityComponent(stage: Stage, daysInStage: number): number {
  const threshold = STAGE_STALL_THRESHOLD_DAYS[stage];
  if (!Number.isFinite(threshold)) return 0;
  const ratio = daysInStage / threshold;
  if (ratio < 0.5) return 6;
  if (ratio < 1) return 3;
  if (ratio < 2) return -4;
  if (ratio < 3) return -9;
  return -15;
}

export function sentimentStats(sentiments: number[]): { avg: number | null; trend: number | null } {
  if (!sentiments.length) return { avg: null, trend: null };
  let weightSum = 0;
  let total = 0;
  sentiments.slice(0, 8).forEach((s, i) => {
    const w = Math.pow(0.8, i);
    total += clamp(s, -1, 1) * w;
    weightSum += w;
  });
  const avg = total / weightSum;
  let trend: number | null = null;
  if (sentiments.length >= 3) {
    const recent = (sentiments[0] + sentiments[1]) / 2;
    const older = sentiments.slice(2, 6);
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    trend = recent - olderAvg;
  }
  return { avg, trend };
}

export function sentimentComponent(sentiments: number[]): number {
  const { avg, trend } = sentimentStats(sentiments);
  if (avg === null) return 0;
  let c = avg * 12;
  if (trend !== null) {
    if (trend <= -0.3) c -= 4;
    else if (trend >= 0.3) c += 2;
  }
  return round1(clamp(c, -12, 12));
}

export function engagementComponent(count30d: number): number {
  if (count30d <= 0) return 0;
  if (count30d <= 2) return 2;
  if (count30d <= 5) return 4;
  return 5;
}

export function computeLeadScore(inputs: ScoreInputs): ScoreBreakdown {
  const now = inputs.now ?? new Date();
  const stagePrior = STAGE_PRIOR[inputs.stage];
  const closed = inputs.stage === "Won" || inputs.stage === "Lost";
  const recency = closed ? 0 : recencyComponent(inputs.daysSinceActivity);
  const value = closed ? 0 : valueComponent(inputs.value);
  const velocity = closed ? 0 : velocityComponent(inputs.stage, inputs.daysInStage);
  const sentiment = closed ? 0 : sentimentComponent(inputs.sentiments);
  const engagement = closed ? 0 : engagementComponent(inputs.engagementCount30d);
  const raw = stagePrior + recency + value + velocity + sentiment + engagement;
  const total = closed ? stagePrior : Math.round(clamp(raw, 0, 100));
  const stats = sentimentStats(inputs.sentiments);
  return {
    stagePrior,
    recency,
    value,
    velocity,
    sentiment,
    engagement,
    total,
    computedAt: now.toISOString(),
    inputs: {
      stage: inputs.stage,
      daysSinceActivity: round1(inputs.daysSinceActivity),
      daysInStage: round1(inputs.daysInStage),
      value: inputs.value,
      avgSentiment: stats.avg === null ? null : Math.round(stats.avg * 100) / 100,
      sentimentTrend: stats.trend === null ? null : Math.round(stats.trend * 100) / 100,
      engagementCount30d: inputs.engagementCount30d,
      sentimentSamples: inputs.sentiments.length,
    },
  };
}

/** Gathers a deal's scoring inputs from the database. */
export async function gatherDealInputs(dealId: string, now = new Date()): Promise<{ deal: InstanceType<typeof Deal>; inputs: ScoreInputs } | null> {
  const deal = await Deal.findById(dealId);
  if (!deal) return null;
  const notes = await Note.find({ deal: deal._id, kind: { $in: ENGAGEMENT_KINDS } })
    .sort({ createdAt: -1 })
    .limit(30)
    .select("sentiment createdAt kind")
    .lean();
  const sentiments = notes.filter((n) => n.sentiment && typeof n.sentiment.score === "number").map((n) => n.sentiment!.score).slice(0, 8);
  const cutoff = daysAgo(30, now);
  const engagementCount30d = notes.filter((n) => n.createdAt && new Date(n.createdAt) >= cutoff).length;
  return {
    deal,
    inputs: {
      stage: deal.stage as Stage,
      value: deal.value ?? 0,
      daysSinceActivity: daysBetween(deal.lastActivityAt ?? deal.createdAt, now),
      daysInStage: daysBetween(deal.stageEnteredAt ?? deal.createdAt, now),
      sentiments,
      engagementCount30d,
      now,
    },
  };
}

export function scoreInputHash(inputs: ScoreInputs): string {
  // Day bucket so a nightly rescan refreshes recency, while same-day duplicate jobs are skipped.
  const day = (inputs.now ?? new Date()).toISOString().slice(0, 10);
  return sha256({
    stage: inputs.stage,
    value: inputs.value,
    daysSinceActivity: Math.floor(inputs.daysSinceActivity),
    daysInStage: Math.floor(inputs.daysInStage),
    sentiments: inputs.sentiments.map((s) => Math.round(s * 100) / 100),
    engagementCount30d: inputs.engagementCount30d,
    day,
  });
}

/** Recomputes a deal's score if its inputs changed. Returns the new score or null when skipped. */
export async function scoreDeal(dealId: string, opts: { force?: boolean } = {}): Promise<number | null> {
  const gathered = await gatherDealInputs(dealId);
  if (!gathered) return null;
  const { deal, inputs } = gathered;
  const hash = scoreInputHash(inputs);
  if (!opts.force && deal.scoreInputHash === hash) {
    return null;
  }
  const breakdown = computeLeadScore(inputs);
  deal.score = breakdown.total;
  deal.scoreBreakdown = breakdown;
  deal.scoreInputHash = hash;
  deal.scoredAt = new Date();
  await deal.save();
  await scoreContact(String(deal.contact));
  logger.debug({ dealId, score: breakdown.total }, "Deal scored");
  return breakdown.total;
}

/**
 * Contact score = best open deal score, otherwise a recency-only engagement score (0..40)
 * so contacts without deals still surface as warm/cold.
 */
export async function scoreContact(contactId: string): Promise<number | null> {
  const contact = await Contact.findById(contactId);
  if (!contact) return null;
  const openDeals = await Deal.find({ contact: contact._id, stage: { $in: OPEN_STAGES } }).select("score").lean();
  let score: number;
  if (openDeals.length) {
    score = Math.max(...openDeals.map((d) => d.score ?? 0));
  } else {
    const days = daysBetween(contact.lastActivityAt ?? contact.createdAt);
    score = Math.round(recencyComponent(days) * 3);
  }
  if (contact.score !== score) {
    contact.score = score;
    contact.scoredAt = new Date();
    await contact.save();
  }
  return score;
}
