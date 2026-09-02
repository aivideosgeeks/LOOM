import { describe, expect, it } from "vitest";
import { evaluateRiskSignals } from "../ai/features/riskFlag";

const now = new Date("2026-09-02T12:00:00Z");

describe("deal risk signals", () => {
  it("is quiet for a healthy deal", () => {
    const r = evaluateRiskSignals({ stage: "Proposal", daysInStage: 5, daysSinceActivity: 2, sentiments: [0.6, 0.4], expectedCloseDate: new Date("2026-10-01"), now, inactivityDays: 14 });
    expect(r.signals).toEqual([]);
  });

  it("flags stalled stage and inactivity with concrete reasons", () => {
    const r = evaluateRiskSignals({ stage: "Proposal", daysInStage: 35, daysSinceActivity: 22, sentiments: [], expectedCloseDate: null, now, inactivityDays: 14 });
    expect(r.signals).toEqual(["stalled", "inactive"]);
    expect(r.reasons[0]).toMatch(/Stuck in Proposal for 35 days \(threshold 21\)/);
    expect(r.reasons[1]).toMatch(/No activity for 22 days/);
  });

  it("flags negative and declining sentiment", () => {
    const negative = evaluateRiskSignals({ stage: "Negotiation", daysInStage: 3, daysSinceActivity: 1, sentiments: [-0.6, -0.3], expectedCloseDate: null, now });
    expect(negative.signals).toContain("sentiment_negative");
    const declining = evaluateRiskSignals({ stage: "Negotiation", daysInStage: 3, daysSinceActivity: 1, sentiments: [0.1, 0.0, 0.1, 0.7, 0.8, 0.6], expectedCloseDate: null, now });
    expect(declining.signals).toContain("sentiment_negative");
    expect(declining.reasons[0]).toMatch(/trending down/);
  });

  it("flags deals expected to close soon that are still early-stage", () => {
    const r = evaluateRiskSignals({ stage: "Lead", daysInStage: 3, daysSinceActivity: 1, sentiments: [], expectedCloseDate: new Date("2026-09-05"), now });
    expect(r.signals).toEqual(["closing_soon_unready"]);
  });

  it("never flags closed deals", () => {
    const r = evaluateRiskSignals({ stage: "Won", daysInStage: 300, daysSinceActivity: 300, sentiments: [-1, -1], expectedCloseDate: null, now });
    expect(r.signals).toEqual([]);
  });
});
