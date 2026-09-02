import { describe, expect, it } from "vitest";
import {
  computeLeadScore,
  engagementComponent,
  recencyComponent,
  scoreInputHash,
  sentimentComponent,
  sentimentStats,
  STAGE_PRIOR,
  valueComponent,
  velocityComponent,
  type ScoreInputs,
} from "../ai/features/leadScore";

const base: ScoreInputs = {
  stage: "Proposal",
  value: 25_000,
  daysSinceActivity: 3,
  daysInStage: 5,
  sentiments: [0.5, 0.3],
  engagementCount30d: 3,
  now: new Date("2026-09-02T12:00:00Z"),
};

describe("lead scoring model", () => {
  it("pins closed stages to their outcome", () => {
    expect(computeLeadScore({ ...base, stage: "Won" }).total).toBe(100);
    expect(computeLeadScore({ ...base, stage: "Lost", sentiments: [1, 1] }).total).toBe(0);
  });

  it("scores a fresh, well-engaged negotiation deal highly", () => {
    const b = computeLeadScore({ ...base, stage: "Negotiation", daysSinceActivity: 1, daysInStage: 4, sentiments: [0.8, 0.7, 0.6], engagementCount30d: 6, value: 120_000 });
    expect(b.total).toBeGreaterThanOrEqual(85);
    expect(b.stagePrior).toBe(STAGE_PRIOR.Negotiation);
    expect(b.recency).toBe(12);
    expect(b.velocity).toBe(6);
    expect(b.engagement).toBe(5);
    expect(b.sentiment).toBeGreaterThan(6);
  });

  it("scores a stale, negative lead very low", () => {
    const b = computeLeadScore({ ...base, stage: "Lead", daysSinceActivity: 75, daysInStage: 70, sentiments: [-0.8, -0.6, -0.1, 0.2], engagementCount30d: 0, value: 500 });
    expect(b.total).toBeLessThanOrEqual(10);
    expect(b.recency).toBe(0);
    expect(b.velocity).toBe(-15);
    expect(b.engagement).toBe(0);
    expect(b.sentiment).toBeLessThan(-6);
  });

  it("penalises time stuck in a stage relative to the stage threshold", () => {
    expect(velocityComponent("Proposal", 5)).toBe(6); // < half of 21 days
    expect(velocityComponent("Proposal", 15)).toBe(3);
    expect(velocityComponent("Proposal", 30)).toBe(-4);
    expect(velocityComponent("Proposal", 50)).toBe(-9);
    expect(velocityComponent("Lead", 60)).toBe(-15);
    expect(velocityComponent("Won", 400)).toBe(0);
    const fresh = computeLeadScore({ ...base, daysInStage: 3 }).total;
    const stalled = computeLeadScore({ ...base, daysInStage: 60 }).total;
    expect(stalled).toBeLessThan(fresh);
  });

  it("rewards recent activity on a decreasing scale", () => {
    expect(recencyComponent(0)).toBe(12);
    expect(recencyComponent(5)).toBe(10);
    expect(recencyComponent(10)).toBe(7);
    expect(recencyComponent(20)).toBe(4);
    expect(recencyComponent(45)).toBe(1);
    expect(recencyComponent(90)).toBe(0);
  });

  it("weights recent sentiment more and applies a trend adjustment", () => {
    expect(sentimentComponent([])).toBe(0);
    expect(sentimentComponent([1])).toBe(12);
    expect(sentimentComponent([-1])).toBe(-12);
    // Latest notes positive, older negative: recent weight dominates and the upward trend adds a bonus.
    const improving = sentimentComponent([0.8, 0.7, -0.5, -0.6, -0.4]);
    const declining = sentimentComponent([-0.5, -0.6, 0.8, 0.7, 0.6]);
    expect(improving).toBeGreaterThan(0);
    expect(declining).toBeLessThan(0);
    expect(declining).toBeLessThan(improving);
    // Explicit trend penalty: recent average far below the older average costs 5 points.
    const samples = [0.1, 0.0, 0.8, 0.9, 0.8];
    const { avg, trend } = sentimentStats(samples);
    expect(trend).toBeLessThan(-0.3);
    expect(sentimentComponent(samples)).toBeCloseTo(Math.round((avg! * 12 - 4) * 10) / 10, 1);
  });

  it("uses a bounded log scale for deal value and buckets engagement", () => {
    expect(valueComponent(0)).toBe(0);
    expect(valueComponent(100)).toBe(0);
    expect(valueComponent(10_000)).toBeGreaterThan(2.5);
    expect(valueComponent(10_000)).toBeLessThan(valueComponent(100_000));
    expect(valueComponent(5_000_000)).toBe(6);
    expect(engagementComponent(0)).toBe(0);
    expect(engagementComponent(2)).toBe(2);
    expect(engagementComponent(4)).toBe(4);
    expect(engagementComponent(9)).toBe(5);
  });

  it("always yields a 0-100 integer with a full explainable breakdown", () => {
    const b = computeLeadScore(base);
    expect(Number.isInteger(b.total)).toBe(true);
    expect(b.total).toBeGreaterThanOrEqual(0);
    expect(b.total).toBeLessThanOrEqual(100);
    expect(b.total).toBe(Math.round(b.stagePrior + b.recency + b.value + b.velocity + b.sentiment + b.engagement));
    expect(b.inputs.sentimentSamples).toBe(2);
    expect(b.inputs.avgSentiment).toBeCloseTo(0.41, 1);
  });

  it("produces the same input hash for unchanged inputs and a different one after a change", () => {
    const h1 = scoreInputHash(base);
    const h2 = scoreInputHash({ ...base, sentiments: [0.5, 0.3] });
    const h3 = scoreInputHash({ ...base, stage: "Negotiation" });
    const h4 = scoreInputHash({ ...base, daysSinceActivity: 3.4 }); // same day bucket
    expect(h1).toBe(h2);
    expect(h1).toBe(h4);
    expect(h1).not.toBe(h3);
  });
});
