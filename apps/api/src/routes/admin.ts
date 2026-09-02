import { Router } from "express";
import { z } from "zod";
import { AI_FEATURES, type AiFeature, type AiUsageRow } from "@loom/shared";
import { badRequest } from "../lib/errors";
import { requireRole } from "../middleware/auth";
import { idParam, parsedQuery, validateQuery } from "../middleware/validate";
import { jobs } from "../jobs/queue";
import { AiUsage } from "../models";
import { circuit, getGatewayStatus } from "../ai/gateway";

export const adminRouter = Router();
adminRouter.use(requireRole("admin"));

const usageQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

/** Token + cost audit per AI feature, plus a daily series for charts. */
adminRouter.get("/ai-usage", validateQuery(usageQuery), async (_req, res) => {
  const { days } = parsedQuery<z.infer<typeof usageQuery>>(res);
  const since = new Date(Date.now() - days * 86_400_000);

  const [byFeature, daily, recent] = await Promise.all([
    AiUsage.aggregate<{
      _id: AiFeature;
      calls: number;
      cached: number;
      errors: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      estCostUsd: number;
      latencyTotal: number;
      billed: number;
    }>([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: "$feature",
          calls: { $sum: 1 },
          cached: { $sum: { $cond: [{ $eq: ["$status", "cached"] }, 1, 0] } },
          errors: { $sum: { $cond: [{ $in: ["$status", ["error", "timeout", "circuit_open"]] }, 1, 0] } },
          inputTokens: { $sum: "$inputTokens" },
          outputTokens: { $sum: "$outputTokens" },
          cacheReadTokens: { $sum: "$cacheReadTokens" },
          estCostUsd: { $sum: "$estCostUsd" },
          latencyTotal: { $sum: { $cond: [{ $eq: ["$status", "ok"] }, "$latencyMs", 0] } },
          billed: { $sum: { $cond: [{ $eq: ["$status", "ok"] }, 1, 0] } },
        },
      },
    ]),
    AiUsage.aggregate<{ _id: { day: string; feature: AiFeature }; calls: number; estCostUsd: number; tokens: number }>([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, feature: "$feature" },
          calls: { $sum: 1 },
          estCostUsd: { $sum: "$estCostUsd" },
          tokens: { $sum: { $add: ["$inputTokens", "$outputTokens"] } },
        },
      },
      { $sort: { "_id.day": 1 } },
    ]),
    AiUsage.find({ createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(50).lean(),
  ]);

  const map = new Map(byFeature.map((r) => [r._id, r]));
  const rows: AiUsageRow[] = AI_FEATURES.map((feature) => {
    const r = map.get(feature);
    return {
      feature,
      calls: r?.calls ?? 0,
      cached: r?.cached ?? 0,
      errors: r?.errors ?? 0,
      inputTokens: r?.inputTokens ?? 0,
      outputTokens: r?.outputTokens ?? 0,
      cacheReadTokens: r?.cacheReadTokens ?? 0,
      estCostUsd: Math.round((r?.estCostUsd ?? 0) * 1e4) / 1e4,
      avgLatencyMs: r && r.billed ? Math.round(r.latencyTotal / r.billed) : 0,
    };
  });

  res.json({
    days,
    status: getGatewayStatus(),
    rows,
    totalCostUsd: Math.round(rows.reduce((a, r) => a + r.estCostUsd, 0) * 1e4) / 1e4,
    daily: daily.map((d) => ({ day: d._id.day, feature: d._id.feature, calls: d.calls, estCostUsd: d.estCostUsd, tokens: d.tokens })),
    recent: recent.map((r) => ({
      id: String(r._id),
      feature: r.feature,
      status: r.status,
      model: r.model,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadTokens,
      estCostUsd: r.estCostUsd,
      latencyMs: r.latencyMs,
      error: r.error,
      createdAt: r.createdAt,
    })),
  });
});

const JOBS: Record<string, () => Promise<void>> = {
  "risk-scan": () => jobs.scanRisk(),
  rescore: () => jobs.rescoreAll(),
  "dedupe-scan": () => jobs.scanDuplicates(),
};

adminRouter.post("/jobs/:name", async (req, res) => {
  const run = JOBS[idParam(req, "name")];
  if (!run) throw badRequest(`Unknown job. Available: ${Object.keys(JOBS).join(", ")}`);
  await run();
  res.status(202).json({ queued: idParam(req, "name") });
});

adminRouter.post("/ai/reset-circuit", (_req, res) => {
  circuit.reset();
  res.json(getGatewayStatus());
});
