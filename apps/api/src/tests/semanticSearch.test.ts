import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setEmbeddingProvider, type EmbeddingProvider } from "../ai/embeddings/provider";
import { semanticSearch } from "../ai/embeddings/semanticSearch";
import { setVectorStore, MongoVectorStore } from "../ai/embeddings/vectorStore";
import { setupTestContext, teardownTestContext, type TestContext } from "./helpers";

/**
 * A tiny concept-bucket embedder standing in for a real model: words about money and
 * resistance share dimensions, so paraphrases land close together while unrelated text does not.
 */
const BUCKETS: Record<string, number> = {
  price: 0, pricing: 0, cost: 0, budget: 0, expensive: 0, discount: 0, quote: 0,
  pushback: 1, objection: 1, objected: 1, concern: 1, concerns: 1, hesitant: 1, resistance: 1,
  security: 2, compliance: 2, soc2: 2, questionnaire: 2,
  timeline: 3, deadline: 3, quarter: 3, delay: 3,
  weather: 4, lunch: 4, sunny: 4,
};

const fakeProvider = (ready = true): EmbeddingProvider => ({
  name: "local",
  model: "fake-buckets-v1",
  async ready() {
    return ready;
  },
  async embed(texts) {
    return texts.map((t) => {
      const v = [0, 0, 0, 0, 0, 0.01];
      for (const w of t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
        if (w in BUCKETS) v[BUCKETS[w]] += 1;
      }
      return v;
    });
  },
});

let ctx: TestContext;
let dealId = "";

beforeAll(async () => {
  ctx = await setupTestContext();
  setEmbeddingProvider(fakeProvider());
  setVectorStore(new MongoVectorStore());
  const contact = await ctx.member.post("/api/contacts").send({ name: "Sam Buyer", email: "sam@buyer.com", company: "Buyer Inc" }).expect(201);
  const deal = await ctx.member.post("/api/deals").send({ title: "Buyer - Platform", contact: contact.body.contact.id, value: 30000 }).expect(201);
  dealId = deal.body.deal.id;
  for (const content of [
    "Finance objected to the budget; they think the quote is too expensive and want a discount.",
    "Security team sent the compliance questionnaire and asked for the SOC2 report.",
    "Lovely sunny weather, we had lunch near the office.",
  ]) {
    await ctx.member.post("/api/notes").send({ deal: dealId, kind: "note", content }).expect(201);
  }
  await ctx.queue.waitForIdle();
});

afterAll(async () => {
  setEmbeddingProvider(null);
  setVectorStore(null);
  await teardownTestContext(ctx);
});

describe("semantic search over notes", () => {
  it("returns the paraphrased note first for a meaning-based query", async () => {
    const res = await ctx.member.get("/api/ai/search?q=pricing%20pushback").expect(200);
    expect(res.body.mode).toBe("semantic");
    expect(res.body.hits.length).toBeGreaterThan(0);
    expect(res.body.hits[0].note.content).toMatch(/objected to the budget/);
    expect(res.body.hits.some((h: { note: { content: string } }) => /sunny weather/.test(h.note.content))).toBe(false);
  });

  it("scopes members to their own notes", async () => {
    const res = await ctx.admin.get("/api/ai/search?q=pricing%20pushback").expect(200);
    expect(res.body.hits.length).toBeGreaterThan(0); // admin sees everything
    const other = await ctx.admin.post("/api/contacts").send({ name: "Admin Contact" }).expect(201);
    await ctx.admin.post("/api/notes").send({ contact: other.body.contact.id, content: "Budget objection from the admin side" }).expect(201);
    await ctx.queue.waitForIdle();
    const memberView = await ctx.member.get("/api/ai/search?q=budget%20objection").expect(200);
    expect(memberView.body.hits.every((h: { note: { content: string } }) => !/admin side/.test(h.note.content))).toBe(true);
  });

  it("degrades to text search when the embedding provider is unavailable", async () => {
    setEmbeddingProvider(fakeProvider(false));
    const res = await ctx.member.get("/api/ai/search?q=questionnaire").expect(200);
    expect(res.body.mode).toBe("text");
    expect(res.body.degradedReason).toMatch(/not available/);
    expect(res.body.hits[0].note.content).toMatch(/questionnaire/);
    setEmbeddingProvider(fakeProvider());
  });
});
