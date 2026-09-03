import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger";
import type { EnqueueOptions, JobEnvelope, JobHandler, JobName, JobPayloads, JobQueue } from "./types";

/**
 * How deep a chain of jobs enqueued by other jobs may run. Enrichment triggers
 * rescoring, which triggers a risk assessment, so a small chain is normal; a
 * longer one means something is cycling and would otherwise hang the request.
 */
const MAX_DEPTH = 3;

/**
 * Queue adapter for serverless, where nothing survives the response.
 *
 * The memory and BullMQ adapters both hand work to a worker that keeps running
 * after the request returns. A serverless function is frozen the moment it
 * responds, so a job handed to a background worker there would simply never run.
 * This adapter therefore runs the handler immediately, inside the request that
 * enqueued it, and awaits it.
 *
 * The trade is latency for correctness: saving a note now waits for its own
 * scoring and sentiment pass rather than seeing them appear a second later. It
 * keeps the same two guarantees callers rely on: a failing job never fails the
 * request, and a job id that is already running is not run again.
 */
export class InlineQueue implements JobQueue {
  readonly provider = "inline" as const;
  private handler: JobHandler | null = null;
  private running = new Set<string>();
  private depth = 0;

  /** Runs the job now. `delayMs` is ignored: there is no later to defer to. */
  async add<N extends JobName>(name: N, data: JobPayloads[N], opts: EnqueueOptions = {}) {
    if (!this.handler) return;
    const id = opts.jobId ?? `${name}:${randomUUID()}`;

    // A handler that re-enqueues the record it is already processing would
    // otherwise recurse. The other adapters de-duplicate the same way.
    if (this.running.has(id)) return;
    if (this.depth >= MAX_DEPTH) {
      logger.warn({ job: name, id, depth: this.depth }, "Inline job chain too deep; skipping nested job");
      return;
    }

    this.running.add(id);
    this.depth += 1;
    try {
      await this.handler({ id, name, data } as JobEnvelope);
    } catch (err) {
      // Same contract as the other adapters: background work failing must not
      // fail the request that happened to trigger it.
      logger.error({ err, job: name, id }, "Job failed");
    } finally {
      this.depth -= 1;
      this.running.delete(id);
    }
  }

  /**
   * No-op. Repeatables need a timer that outlives the request, which serverless
   * does not have. The scheduled scans are driven by platform cron calling the
   * /api/cron routes, which enqueue the same jobs through this adapter.
   */
  async schedule() {}

  async start(handler: JobHandler) {
    this.handler = handler;
  }

  /** Jobs are awaited inside add(), so the queue is never busy once this is reached. */
  async waitForIdle() {}

  async close() {
    this.handler = null;
  }
}
