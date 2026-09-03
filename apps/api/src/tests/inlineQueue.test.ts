import { describe, expect, it } from "vitest";
import { InlineQueue } from "../jobs/inlineQueue";
import type { JobEnvelope } from "../jobs/types";

/** Records every job the queue actually ran, in order. */
function recorder() {
  const ran: string[] = [];
  return { ran, handler: async (job: JobEnvelope) => void ran.push(job.name) };
}

describe("inline job queue", () => {
  it("runs the job before add() resolves, since nothing survives the response", async () => {
    const { ran, handler } = recorder();
    const q = new InlineQueue();
    await q.start(handler);

    await q.add("deal.score", { dealId: "d1" });

    // The memory adapter would still have this pending here.
    expect(ran).toEqual(["deal.score"]);
  });

  it("ignores delayMs rather than dropping the job", async () => {
    const { ran, handler } = recorder();
    const q = new InlineQueue();
    await q.start(handler);

    await q.add("contact.score", { contactId: "c1" }, { delayMs: 5_000 });

    expect(ran).toEqual(["contact.score"]);
  });

  it("does not fail the caller when a job throws", async () => {
    const q = new InlineQueue();
    await q.start(async () => {
      throw new Error("scoring blew up");
    });

    // A note save must still succeed even if its enrichment fails.
    await expect(q.add("note.enrich", { noteId: "n1" })).resolves.toBeUndefined();
  });

  it("does not re-run a job id that is already running", async () => {
    let calls = 0;
    const q = new InlineQueue();
    await q.start(async (job) => {
      calls += 1;
      // A handler that re-enqueues the record it is processing must not recurse.
      await q.add(job.name, job.data, { jobId: job.id });
    });

    await q.add("deal.score", { dealId: "d1" }, { jobId: "deal.score:d1" });

    expect(calls).toBe(1);
  });

  it("caps a chain of distinct jobs enqueuing each other", async () => {
    let calls = 0;
    const q = new InlineQueue();
    await q.start(async () => {
      calls += 1;
      // Each hop uses a fresh id, so only the depth cap can stop it.
      await q.add("deal.score", { dealId: `d${calls}` }, { jobId: `deal.score:d${calls}` });
    });

    await q.add("deal.score", { dealId: "d0" }, { jobId: "deal.score:d0" });

    expect(calls).toBe(3);
  });

  it("reports itself as inline and is always idle", async () => {
    const q = new InlineQueue();
    expect(q.provider).toBe("inline");
    await expect(q.waitForIdle()).resolves.toBeUndefined();
  });

  it("stops running jobs once closed", async () => {
    const { ran, handler } = recorder();
    const q = new InlineQueue();
    await q.start(handler);
    await q.close();

    await q.add("risk.scan", {});

    expect(ran).toEqual([]);
  });
});
