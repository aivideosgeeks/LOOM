import { Router } from "express";
import { badRequest, notFound } from "../lib/errors";
import { ownerScope, requireAuth } from "../middleware/auth";
import { idParam } from "../middleware/validate";
import { jobs } from "../jobs/queue";
import { Meeting } from "../models";
import { toMeetingDTO } from "../services/serializers";

export const meetingsRouter = Router();
meetingsRouter.use(requireAuth);

meetingsRouter.get("/:id", async (req, res) => {
  const meeting = await Meeting.findOne({ _id: idParam(req), ...ownerScope(req) }).select("-transcript").lean();
  if (!meeting) throw notFound("Meeting");
  res.json({ meeting: toMeetingDTO(meeting) });
});

meetingsRouter.get("/:id/transcript", async (req, res) => {
  const meeting = await Meeting.findOne({ _id: idParam(req), ...ownerScope(req) }).select("transcript title").lean();
  if (!meeting) throw notFound("Meeting");
  res.json({ title: meeting.title, transcript: meeting.transcript });
});

/** Re-run summarisation (e.g. after the AI provider comes back). */
meetingsRouter.post("/:id/retry", async (req, res) => {
  const meeting = await Meeting.findOne({ _id: idParam(req), ...ownerScope(req) });
  if (!meeting) throw notFound("Meeting");
  if (meeting.status === "processing") throw badRequest("Meeting is already being processed");
  meeting.status = "pending";
  meeting.error = null;
  await meeting.save();
  await jobs.summarizeMeeting(String(meeting._id));
  res.status(202).json({ meeting: toMeetingDTO(meeting) });
});
