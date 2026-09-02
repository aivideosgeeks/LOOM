import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger";
import type { EnqueueOptions, JobEnvelope, JobHandler, JobName, JobPayloads, JobQueue } from "./types";

const DAY_MS = 86_400_000;

/**
 * In-process queue used when REDIS_URL is not configured (local dev, tests).
 * Same contract as the BullMQ adapter: async, off the request path, jobId de-duplication,
 * delays, and interval-based repeatables. Not durable: pending jobs are lost on restart.
 */
export class MemoryQueue implements JobQueue {
  readonly provider = "memory" as const;
  private pending: JobEnvelope[] = [];
  private known = new Set<string>();
  private active = 0;
  private handler: JobHandler | null = null;
  private timers = new Set<NodeJS.Timeout>();
  private intervals = new Set<NodeJS.Timeout>();
  private idleWaiters: Array<() => void> = [];
  private closed = false;

  constructor(private concurrency = 2) {}

  async add<N extends JobName>(name: N, data: JobPayloads[N], opts: EnqueueOptions = {}) {
    if (this.closed) return;
    const id = opts.jobId ?? `${name}:${randomUUID()}`;
    if (this.known.has(id)) return;
    this.known.add(id);
    const job = { id, name, data } as JobEnvelope;
    if (opts.delayMs && opts.delayMs > 0) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.push(job);
      }, opts.delayMs);
      this.timers.add(timer);
    } else {
      this.push(job);
    }
  }

  async schedule<N extends JobName>(schedulerId: string, name: N, data: JobPayloads[N], cron: string) {
    // The memory queue approximates cron with a fixed interval derived from the expression
    // (hourly for "0 * * * *", otherwise daily). BullMQ honours the real cron pattern.
    const everyMs = /^\d+ \* \* \* \*$/.test(cron) ? 3_600_000 : DAY_MS;
    const interval = setInterval(() => void this.add(name, data, { jobId: `${schedulerId}:${Date.now()}` }), everyMs);
    interval.unref?.();
    this.intervals.add(interval);
  }

  async start(handler: JobHandler) {
    this.handler = handler;
    this.pump();
  }

  waitForIdle(timeoutMs = 30_000): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for queue to drain")), timeoutMs);
      this.idleWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async close() {
    this.closed = true;
    for (const t of this.timers) clearTimeout(t);
    for (const i of this.intervals) clearInterval(i);
    this.timers.clear();
    this.intervals.clear();
    this.pending = [];
  }

  private isIdle() {
    return this.pending.length === 0 && this.active === 0 && this.timers.size === 0;
  }

  private push(job: JobEnvelope) {
    this.pending.push(job);
    this.pump();
  }

  private pump() {
    if (!this.handler || this.closed) return;
    while (this.active < this.concurrency && this.pending.length) {
      const job = this.pending.shift()!;
      this.active += 1;
      this.handler(job)
        .catch((err) => logger.error({ err, job: job.name, id: job.id }, "Job failed"))
        .finally(() => {
          this.active -= 1;
          this.known.delete(job.id);
          this.pump();
          if (this.isIdle()) {
            const waiters = this.idleWaiters;
            this.idleWaiters = [];
            waiters.forEach((w) => w());
          }
        });
    }
  }
}
