import { Router } from "express";
import { z } from "zod";
import { mergeContactsSchema } from "@loom/shared";
import { requireRole } from "../middleware/auth";
import { idParam, parsedQuery, validateBody, validateQuery } from "../middleware/validate";
import { jobs } from "../jobs/queue";
import { DuplicateCandidate } from "../models";
import { dismissCandidate, mergeContacts } from "../services/merge";
import { toContactDTO, toDuplicateDTO } from "../services/serializers";

/** Review queue. Admin only: merges are a human decision, never automatic. */
export const duplicatesRouter = Router();
duplicatesRouter.use(requireRole("admin"));

const listQuery = z.object({
  status: z.enum(["pending", "merged", "dismissed", "all"]).default("pending"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

duplicatesRouter.get("/", validateQuery(listQuery), async (_req, res) => {
  const q = parsedQuery<z.infer<typeof listQuery>>(res);
  const filter = q.status === "all" ? {} : { status: q.status };
  const [candidates, pending] = await Promise.all([
    DuplicateCandidate.find(filter)
      .sort({ score: -1, createdAt: -1 })
      .limit(q.limit)
      .populate({ path: "a", populate: { path: "owner", select: "name email role" } })
      .populate({ path: "b", populate: { path: "owner", select: "name email role" } })
      .lean(),
    DuplicateCandidate.countDocuments({ status: "pending" }),
  ]);
  res.json({ candidates: candidates.filter((c) => c.a && c.b).map(toDuplicateDTO), pending });
});

duplicatesRouter.post("/scan", async (_req, res) => {
  await jobs.scanDuplicates();
  res.status(202).json({ queued: true });
});

duplicatesRouter.post("/:id/merge", validateBody(mergeContactsSchema), async (req, res) => {
  const survivor = await mergeContacts(idParam(req), req.body.survivorId, req.user!.id);
  await survivor.populate("owner", "name email role");
  res.json({ contact: toContactDTO(survivor) });
});

duplicatesRouter.post("/:id/dismiss", async (req, res) => {
  await dismissCandidate(idParam(req), req.user!.id);
  res.json({ ok: true });
});
