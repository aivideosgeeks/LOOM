import { timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { env } from "../config/env";
import { jobs } from "../jobs";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";

export const cronRouter = Router();

function equals(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * These routes trigger whole-collection scans, so they are gated on a shared
 * secret rather than a user session. Vercel Cron sends it as a bearer token.
 *
 * With no secret configured the routes report 404 rather than 401, so an
 * instance that never meant to expose them does not advertise that they exist.
 */
function assertScheduler(req: Request) {
  if (!env.CRON_SECRET) throw new HttpError(404, "Not found");
  const header = req.get("authorization") ?? "";
  if (!equals(header, `Bearer ${env.CRON_SECRET}`)) throw new HttpError(401, "Unauthorized");
}

/**
 * The nightly pass, as one call.
 *
 * With a real queue these are three separate repeatables. Platform schedulers
 * limit how many cron entries a free plan may have, so they are folded into a
 * single daily endpoint. Each underlying job is keyed on an input hash and skips
 * records that have not changed, so running them together costs little more than
 * running them apart.
 */
async function runDaily(req: Request, res: Response) {
  assertScheduler(req);
  const started = Date.now();
  await jobs.rescoreAll();
  await jobs.scanRisk();
  await jobs.scanDuplicates();
  const ms = Date.now() - started;
  logger.info({ ms }, "Scheduled daily scan complete");
  res.json({ ok: true, ran: ["score.scanAll", "risk.scan", "dedupe.scanAll"], ms });
}

// Vercel Cron issues GET; POST is accepted so the same route can be triggered
// by hand or by a scheduler that prefers it.
cronRouter.get("/daily", runDaily);
cronRouter.post("/daily", runDaily);
