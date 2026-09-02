"use client";

import { useEffect, useState } from "react";
import type { RiskFlag, ScoreBreakdown, Sentiment, Stage } from "@loom/shared";
import { AlertTriangle, Bot, Sparkles, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Tone = "hot" | "warm" | "cold";

function toneFor(score: number): Tone {
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}

const TONE_TEXT: Record<Tone, string> = {
  hot: "text-good",
  warm: "text-caution",
  cold: "text-ink-3",
};

const TONE_STROKE: Record<Tone, string> = {
  hot: "var(--good)",
  warm: "var(--caution)",
  cold: "var(--ink-3)",
};

/**
 * The lead score as a micro radial gauge. It is the most-repeated element in the
 * app, so it carries the identity: the arc gives an at-a-glance read before the
 * number is even read, and the colour band says hot / warm / cold.
 */
export function ScoreBadge({ score, breakdown, size = "sm" }: { score: number; breakdown?: ScoreBreakdown | null; size?: "sm" | "lg" }) {
  const [drawn, setDrawn] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(score));
    return () => cancelAnimationFrame(id);
  }, [score]);

  const tone = toneFor(score);
  const px = size === "lg" ? 46 : 26;
  const stroke = size === "lg" ? 3.5 : 2.5;
  const r = (px - stroke) / 2 - 0.5;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.max(0, Math.min(100, drawn)) / 100);

  const gauge = (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", TONE_TEXT[tone])}
      style={{ width: px, height: px }}
      aria-label={`Lead score ${score} out of 100`}
      role="img"
    >
      <svg width={px} height={px} viewBox={`0 0 ${px} ${px}`} className="-rotate-90">
        <circle cx={px / 2} cy={px / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle
          className="gauge-arc"
          cx={px / 2}
          cy={px / 2}
          r={r}
          fill="none"
          stroke={TONE_STROKE[tone]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span className={cn("absolute font-semibold tabular", size === "lg" ? "text-sm" : "text-[10px]")}>{score}</span>
    </span>
  );

  if (!breakdown) return gauge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{gauge}</TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <ScoreBreakdownList breakdown={breakdown} compact />
      </TooltipContent>
    </Tooltip>
  );
}

const COMPONENT_LABELS: Array<{ key: keyof Omit<ScoreBreakdown, "total" | "computedAt" | "inputs">; label: string; hint: (b: ScoreBreakdown) => string }> = [
  { key: "stagePrior", label: "Stage prior", hint: (b) => b.inputs.stage },
  { key: "recency", label: "Recency", hint: (b) => `${Math.round(b.inputs.daysSinceActivity)}d since activity` },
  { key: "value", label: "Deal value", hint: (b) => `$${b.inputs.value.toLocaleString()}` },
  { key: "velocity", label: "Stage velocity", hint: (b) => `${Math.round(b.inputs.daysInStage)}d in stage` },
  { key: "sentiment", label: "Note sentiment", hint: (b) => (b.inputs.avgSentiment === null ? "no notes yet" : `avg ${b.inputs.avgSentiment} over ${b.inputs.sentimentSamples} notes`) },
  { key: "engagement", label: "Engagement", hint: (b) => `${b.inputs.engagementCount30d} touches / 30d` },
];

export function ScoreBreakdownList({ breakdown, compact = false }: { breakdown: ScoreBreakdown; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1", compact ? "text-xs" : "text-sm")}>
      {!compact && <p className="mb-1 font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase">How this score was computed</p>}
      {COMPONENT_LABELS.map(({ key, label, hint }) => {
        const value = breakdown[key];
        return (
          <div key={key} className="flex items-baseline justify-between gap-4">
            <span>
              {label} <span className="text-ink-3">· {hint(breakdown)}</span>
            </span>
            <span className={cn("font-mono tabular", value > 0 ? "text-good" : value < 0 ? "text-bad" : "text-ink-3")}>
              {value > 0 ? `+${value}` : value}
            </span>
          </div>
        );
      })}
      <div className="mt-1 flex items-baseline justify-between border-t border-line pt-1.5 font-semibold">
        <span>Total</span>
        <span className="font-mono tabular">{breakdown.total}</span>
      </div>
    </div>
  );
}

/**
 * Stage colour runs cool to warm as the deal advances, so the hue itself
 * reports progress. Won and Lost step out of the ramp into their outcomes.
 */
const STAGE_STYLES: Record<Stage, string> = {
  Lead: "bg-sunk text-ink-2 ring-line-strong",
  Contacted: "bg-signal-wash text-signal ring-signal-line",
  Proposal: "bg-signal-wash text-signal ring-signal-line",
  Negotiation: "bg-caution-wash text-caution ring-caution/30",
  Won: "bg-good-wash text-good ring-good/30",
  Lost: "bg-bad-wash text-bad ring-bad/25",
};

const STAGE_DOT: Record<Stage, string> = {
  Lead: "bg-ink-3",
  Contacted: "bg-signal/50",
  Proposal: "bg-signal",
  Negotiation: "bg-caution",
  Won: "bg-good",
  Lost: "bg-bad",
};

export function StageBadge({ stage }: { stage: Stage }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset transition-colors duration-200", STAGE_STYLES[stage])}>
      <span className={cn("size-1.5 rounded-full", STAGE_DOT[stage])} />
      {stage}
    </span>
  );
}

export function RiskBadge({ risk, showReason = false }: { risk: RiskFlag | null | undefined; showReason?: boolean }) {
  if (!risk?.atRisk) return null;
  const badge = (
    <span className="inline-flex items-center gap-1 rounded-md bg-bad-wash px-2 py-0.5 text-xs font-medium text-bad ring-1 ring-bad/25 ring-inset">
      <AlertTriangle className="size-3" /> At risk
    </span>
  );
  if (!showReason) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p>{risk.aiReason ?? risk.reasons.join(" ")}</p>
        </TooltipContent>
      </Tooltip>
    );
  }
  return badge;
}

export function SentimentBadge({ sentiment }: { sentiment: Sentiment | null | undefined }) {
  if (!sentiment) return null;
  const style =
    sentiment.label === "positive"
      ? "bg-good-wash text-good"
      : sentiment.label === "negative"
        ? "bg-bad-wash text-bad"
        : "bg-sunk text-ink-2";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium capitalize transition-colors duration-200", style)}>
          {sentiment.source === "ai" ? <Bot className="size-3" /> : null}
          {sentiment.label} {sentiment.score > 0 ? "+" : ""}
          {sentiment.score}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p>{sentiment.rationale ?? "No rationale"}</p>
        <p className="mt-1 text-xs text-ink-3">Source: {sentiment.source === "ai" ? "Claude" : sentiment.source === "lexicon" ? "keyword fallback" : "manual"}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function AiSourceBadge({ source }: { source: "ai" | "template" | "fallback" | "heuristic" | null | undefined }) {
  if (!source) return null;
  const isAi = source === "ai";
  return (
    <Badge variant={isAi ? "default" : "outline"} className="gap-1">
      {isAi ? <Bot className="size-3" /> : <Wand2 className="size-3" />}
      {isAi ? "Generated by Claude" : source === "template" ? "Template (AI offline)" : source === "heuristic" ? "Rule-based (AI offline)" : "Basic extraction (AI offline)"}
    </Badge>
  );
}
