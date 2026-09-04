import { z } from "zod";
import { ENGAGEMENT_KINDS, OPEN_STAGES, STAGE_STALL_THRESHOLD_DAYS, type RiskFlag, type RiskSignal, type Stage } from "@loom/shared";
import { env } from "../../config/env";
import { daysBetween } from "../../lib/dates";
import { sha256 } from "../../lib/hash";
import { logger } from "../../lib/logger";
import { Deal, Note } from "../../models";
import { callStructured } from "../gateway";
import { RISK_REASON_SYSTEM } from "../prompts";
import { notify } from "../../services/notifications";
import { sanitizeText, wrapData } from "../sanitize";

export const riskReasonSchema = z.object({
  reason: z.string(),
  suggestedAction: z.string(),
});

export interface RiskInputs {
  stage: Stage;
  daysInStage: number;
  daysSinceActivity: number;
  /** Most recent first. */
  sentiments: number[];
  expectedCloseDate: Date | null;
  now?: Date;
  inactivityDays?: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Pure rule evaluation. Returns the signals that fired with human-readable reasons. */
export function evaluateRiskSignals(inputs: RiskInputs): { signals: RiskSignal[]; reasons: string[] } {
  const signals: RiskSignal[] = [];
  const reasons: string[] = [];
  const now = inputs.now ?? new Date();
  const inactivityDays = inputs.inactivityDays ?? env.RISK_INACTIVITY_DAYS;

  if (!OPEN_STAGES.includes(inputs.stage)) return { signals, reasons };

  const threshold = STAGE_STALL_THRESHOLD_DAYS[inputs.stage];
  if (inputs.daysInStage > threshold) {
    signals.push("stalled");
    reasons.push(`Stuck in ${inputs.stage} for ${Math.floor(inputs.daysInStage)} days (threshold ${threshold}).`);
  }
  if (inputs.daysSinceActivity > inactivityDays) {
    signals.push("inactive");
    reasons.push(`No activity for ${Math.floor(inputs.daysSinceActivity)} days.`);
  }
  if (inputs.sentiments.length >= 2) {
    const recent = inputs.sentiments.slice(0, 3);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const older = inputs.sentiments.slice(3, 6);
    const olderAvg = older.length ? older.reduce((a, b) => a + b, 0) / older.length : null;
    if (recentAvg <= -0.2) {
      signals.push("sentiment_negative");
      reasons.push(`Recent sentiment is negative (average ${round1(recentAvg)}).`);
    } else if (olderAvg !== null && recentAvg - olderAvg <= -0.4) {
      signals.push("sentiment_negative");
      reasons.push(`Sentiment is trending down (from ${round1(olderAvg)} to ${round1(recentAvg)}).`);
    }
  }
  if (inputs.expectedCloseDate) {
    const daysToClose = (inputs.expectedCloseDate.getTime() - now.getTime()) / 86_400_000;
    if (daysToClose <= 7 && (inputs.stage === "Lead" || inputs.stage === "Contacted")) {
      signals.push("closing_soon_unready");
      reasons.push(
        daysToClose < 0
          ? `Expected close date passed ${Math.floor(-daysToClose)} days ago while still in ${inputs.stage}.`
          : `Expected to close in ${Math.ceil(daysToClose)} days but still in ${inputs.stage}.`,
      );
    }
  }
  return { signals, reasons };
}

const ACTIONS: Record<RiskSignal, string> = {
  stalled: "Book a call to agree the next concrete step and a decision date.",
  inactive: "Re-engage today with a value-add follow-up (new insight, case study or agenda for a call).",
  sentiment_negative: "Address the objections raised in recent notes head-on and confirm what blockers remain.",
  closing_soon_unready: "Check whether the close date is realistic and what is needed to advance the stage.",
};

export async function assessDealRisk(dealId: string, opts: { force?: boolean } = {}): Promise<RiskFlag | null> {
  const deal = await Deal.findById(dealId);
  if (!deal) return null;
  const now = new Date();

  if (!OPEN_STAGES.includes(deal.stage as Stage)) {
    if (deal.risk) {
      deal.risk = null;
      deal.riskHash = null;
      await deal.save();
    }
    return null;
  }

  const notes = await Note.find({ deal: deal._id, kind: { $in: ENGAGEMENT_KINDS } })
    .sort({ createdAt: -1 })
    .limit(6)
    .select("content sentiment createdAt kind")
    .lean();
  const sentiments = notes.filter((n) => n.sentiment).map((n) => n.sentiment!.score);

  const { signals, reasons } = evaluateRiskSignals({
    stage: deal.stage as Stage,
    daysInStage: daysBetween(deal.stageEnteredAt ?? deal.createdAt, now),
    daysSinceActivity: daysBetween(deal.lastActivityAt ?? deal.createdAt, now),
    sentiments,
    expectedCloseDate: deal.expectedCloseDate ?? null,
    now,
  });

  const day = now.toISOString().slice(0, 10);
  const hash = sha256({ signals, reasons, day });
  if (!opts.force && deal.riskHash === hash && deal.risk) {
    return deal.risk as RiskFlag;
  }

  const previous = deal.risk as RiskFlag | null;
  let flag: RiskFlag;
  if (!signals.length) {
    flag = { atRisk: false, signals: [], reasons: [], aiReason: null, suggestedAction: null, reasonSource: null, flaggedAt: null, checkedAt: now.toISOString() };
  } else {
    const noteBlocks = notes
      .slice()
      .reverse()
      .map((n) => wrapData("note", n.content, { kind: n.kind, date: n.createdAt ? new Date(n.createdAt).toISOString().slice(0, 10) : "", sentiment: n.sentiment?.label ?? "" }, 600))
      .join("\n");
    const user = [
      wrapData("deal", `Title: ${deal.title}\nStage: ${deal.stage}\nValue: $${(deal.value ?? 0).toLocaleString("en-US")}\nDays in stage: ${Math.floor(daysBetween(deal.stageEnteredAt ?? deal.createdAt, now))}\nDays since last activity: ${Math.floor(daysBetween(deal.lastActivityAt ?? deal.createdAt, now))}\nExpected close: ${deal.expectedCloseDate ? new Date(deal.expectedCloseDate).toISOString().slice(0, 10) : "not set"}`, { id: String(deal._id) }, 600),
      `Signals that fired: ${signals.join(", ")}`,
      `Rule explanations:\n${reasons.map((r) => `- ${r}`).join("\n")}`,
      notes.length ? `Recent notes (oldest first):\n${noteBlocks}` : "No notes recorded.",
    ].join("\n\n");

    const result = await callStructured({
      feature: "risk_flagging",
      schema: riskReasonSchema,
      system: RISK_REASON_SYSTEM,
      user,
      effort: "low",
      maxTokens: 2048,
      timeoutMs: 30_000,
      cache: { key: sha256({ dealId, signals, reasons, notes: notes.map((n) => String(n._id)) }), ttlMs: 24 * 3_600_000 },
      ref: { type: "deal", id: String(deal._id) },
    });

    flag = {
      atRisk: true,
      signals,
      reasons,
      aiReason: result.ok ? sanitizeText(result.data.reason, 500) : reasons.join(" "),
      suggestedAction: result.ok ? sanitizeText(result.data.suggestedAction, 300) : ACTIONS[signals[0]],
      reasonSource: result.ok ? "ai" : "template",
      flaggedAt: previous?.atRisk && previous.flaggedAt ? previous.flaggedAt : now.toISOString(),
      checkedAt: now.toISOString(),
    };
  }

  const newlyAtRisk = flag?.atRisk && !previous?.atRisk;

  deal.risk = flag;
  deal.riskHash = hash;
  deal.markModified("risk");
  await deal.save();

  // Only on the transition. A deal that stays risky across nightly scans would
  // otherwise notify every night until someone fixed it.
  if (newlyAtRisk) {
    await notify({
      userId: String(deal.owner),
      kind: "deal_risk",
      title: `${deal.title} is at risk`,
      body: flag!.aiReason ?? flag!.reasons.join(" "),
      href: `/deals/${String(deal._id)}`,
      dedupeKey: `deal_risk:${String(deal._id)}`,
    });
  }

  return flag;
}

/** Daily scan over all open deals. */
export async function scanAllDealsForRisk(): Promise<{ scanned: number; flagged: number }> {
  const deals = await Deal.find({ stage: { $in: OPEN_STAGES } }).select("_id").lean();
  let flagged = 0;
  for (const d of deals) {
    try {
      const flag = await assessDealRisk(String(d._id));
      if (flag?.atRisk) flagged += 1;
    } catch (err) {
      logger.warn({ err, dealId: d._id }, "Risk assessment failed for deal");
    }
  }
  logger.info({ scanned: deals.length, flagged }, "Risk scan complete");
  return { scanned: deals.length, flagged };
}
