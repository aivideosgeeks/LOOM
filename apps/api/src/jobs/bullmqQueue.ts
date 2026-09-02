import { Queue, Worker } from "bullmq";
import { logger } from "../lib/logger";
import type { EnqueueOptions, JobEnvelope, JobHandler, JobName, JobPayloads, JobQueue } from "./types";

const QUEUE_NAME = "crm-ai";

function parseRedisUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined,
    tls: u.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null as null,
  };
}

/** Durable queue backed by Redis. Used automatically when REDIS_URL is set. */
export class BullQueue implements JobQueue {
  readonly provider = "bullmq" as const;
  private queue: Queue;
  private worker: Worker | null = null;
  private connection: ReturnType<typeof parseRedisUrl>;

  constructor(redisUrl: string, private concurrency = 4) {
    this.connection = parseRedisUrl(redisUrl);
    this.queue = new Queue(QUEUE_NAME, {
      connection: this.connection,
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
      },
    });
  }

  async add<N extends JobName>(name: N, data: JobPayloads[N], opts: EnqueueOptions = {}) {
    await this.queue.add(name, data, {
      jobId: opts.jobId ? opts.jobId.replace(/:/g, "-") : undefined,
      delay: opts.delayMs,
    });
  }

  async schedule<N extends JobName>(schedulerId: string, name: N, data: JobPayloads[N], cron: string) {
    await this.queue.upsertJobScheduler(schedulerId, { pattern: cron }, { name, data });
  }

  async start(handler: JobHandler) {
    this.worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        await handler({ id: String(job.id ?? job.name), name: job.name as JobName, data: job.data } as JobEnvelope);
      },
      { connection: this.connection, concurrency: this.concurrency },
    );
    this.worker.on("failed", (job, err) => logger.error({ err, job: job?.name, id: job?.id }, "Job failed"));
    this.worker.on("error", (err) => logger.error({ err }, "Worker error"));
  }

  async waitForIdle(timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const counts = await this.queue.getJobCounts("waiting", "active", "delayed", "prioritized");
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      if (total === 0) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("Timed out waiting for queue to drain");
  }

  async close() {
    await this.worker?.close();
    await this.queue.close();
  }
}
