import { env, isTest } from "../config/env";
import { logger } from "../lib/logger";
import { handleJob } from "./handlers";
import { getQueue, jobs } from "./queue";

export async function startJobs() {
  const queue = await getQueue();
  await queue.start(handleJob);
  await queue.schedule("risk-daily", "risk.scan", {}, env.RISK_SCAN_CRON);
  await queue.schedule("score-daily", "score.scanAll", {}, "0 5 * * *");
  await queue.schedule("dedupe-nightly", "dedupe.scanAll", {}, "30 5 * * *");
  // Runs whether or not a webhook subscription succeeded, because on TikTok it
  // frequently does not and a fallback nobody exercises is not a fallback.
  await queue.schedule("integration-poll", "integration.poll", {}, env.INTEGRATION_POLL_CRON);
  await queue.schedule("integration-retry", "integration.retry", {}, "*/30 * * * *");
  await queue.schedule("integration-refresh", "integration.refresh", {}, "0 4 * * *");
  // Skipped on the inline adapter: there it would run two whole-collection
  // scans inside the first request of every cold start. Platform cron calls
  // /api/cron/daily instead.
  if (env.RISK_SCAN_ON_START && !isTest && queue.provider !== "inline") {
    await jobs.rescoreAll();
    await jobs.scanRisk();
  }
  logger.info({ provider: queue.provider }, "Job workers started");
}

export async function stopJobs() {
  const queue = await getQueue();
  await queue.close();
}

export { getQueue, jobs };
