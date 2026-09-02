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
  if (env.RISK_SCAN_ON_START && !isTest) {
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
