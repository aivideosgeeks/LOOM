export interface JobPayloads {
  "deal.score": { dealId: string };
  "contact.score": { contactId: string };
  "note.enrich": { noteId: string };
  "meeting.summarize": { meetingId: string };
  "contact.dedupe": { contactId: string };
  "dedupe.scanAll": Record<string, never>;
  "risk.scan": Record<string, never>;
  "deal.risk": { dealId: string };
  "score.scanAll": Record<string, never>;
}

export type JobName = keyof JobPayloads;

/** Discriminated union over job names so handlers can narrow `data` by `name`. */
export type JobEnvelope = {
  [N in JobName]: { id: string; name: N; data: JobPayloads[N] };
}[JobName];

export type JobHandler = (job: JobEnvelope) => Promise<void>;

export interface EnqueueOptions {
  /** Jobs with the same id coalesce while one is pending. */
  jobId?: string;
  delayMs?: number;
}

export interface JobQueue {
  readonly provider: "bullmq" | "memory";
  add<N extends JobName>(name: N, data: JobPayloads[N], opts?: EnqueueOptions): Promise<void>;
  /** Repeatable job. `cron` is a standard 5-field cron expression. */
  schedule<N extends JobName>(schedulerId: string, name: N, data: JobPayloads[N], cron: string): Promise<void>;
  start(handler: JobHandler): Promise<void>;
  /** Resolves when no jobs are pending or running (memory queue; BullMQ polls counts). */
  waitForIdle(timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}
