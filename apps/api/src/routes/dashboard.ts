import { Router } from "express";
import { Types } from "mongoose";
import { OPEN_STAGES, PIPELINE_STAGES } from "@loom/shared";
import { requireAuth } from "../middleware/auth";
import { Contact, Deal, Note, Task } from "../models";
import { toDealDTO, toNoteDTO, toTaskDTO } from "../services/serializers";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get("/", async (req, res) => {
  const scope = req.user!.role === "admin" ? {} : { owner: new Types.ObjectId(req.user!.id) };
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 86_400_000);

  const [byStage, contacts, atRiskDeals, topDeals, recentNotes, tasksDue, atRiskCount] = await Promise.all([
    Deal.aggregate<{ _id: string; count: number; value: number }>([
      { $match: scope },
      { $group: { _id: "$stage", count: { $sum: 1 }, value: { $sum: "$value" } } },
    ]),
    Contact.countDocuments({ ...scope, mergedInto: null }),
    Deal.find({ ...scope, "risk.atRisk": true, stage: { $in: OPEN_STAGES } })
      .sort({ value: -1 })
      .limit(10)
      .populate("contact", "name company email")
      .populate("owner", "name email role")
      .lean(),
    Deal.find({ ...scope, stage: { $in: OPEN_STAGES } })
      .sort({ score: -1, value: -1 })
      .limit(5)
      .populate("contact", "name company email")
      .populate("owner", "name email role")
      .lean(),
    Note.find({ ...scope, kind: { $ne: "system" } }).sort({ createdAt: -1 }).limit(8).populate("author", "name email role").lean(),
    Task.find({ ...scope, done: false, dueDate: { $lte: weekAhead } }).sort({ dueDate: 1 }).limit(10).lean(),
    Deal.countDocuments({ ...scope, "risk.atRisk": true, stage: { $in: OPEN_STAGES } }),
  ]);

  const stageMap = new Map(byStage.map((s) => [s._id, s]));
  const pipeline = PIPELINE_STAGES.map((stage) => ({
    stage,
    count: stageMap.get(stage)?.count ?? 0,
    value: stageMap.get(stage)?.value ?? 0,
  }));
  const open = pipeline.filter((p) => OPEN_STAGES.includes(p.stage));

  res.json({
    pipeline,
    totals: {
      openDeals: open.reduce((a, p) => a + p.count, 0),
      openValue: open.reduce((a, p) => a + p.value, 0),
      wonValue: stageMap.get("Won")?.value ?? 0,
      contacts,
      atRisk: atRiskCount,
    },
    atRiskDeals: atRiskDeals.map(toDealDTO),
    topDeals: topDeals.map(toDealDTO),
    recentActivity: recentNotes.map(toNoteDTO),
    tasksDue: tasksDue.map(toTaskDTO),
  });
});
