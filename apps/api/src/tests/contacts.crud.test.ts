import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Deal } from "../models";
import { setupTestContext, teardownTestContext, type TestContext } from "./helpers";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await setupTestContext();
});

afterAll(async () => {
  await teardownTestContext(ctx);
});

describe("contacts CRUD with role-based access", () => {
  let contactId = "";

  it("rejects anonymous access", async () => {
    await ctx.admin.get("/api/auth/me").expect(200);
    const anon = (await import("supertest")).default(ctx.app);
    await anon.get("/api/contacts").expect(401);
  });

  it("creates a contact (member owns it)", async () => {
    const res = await ctx.member.post("/api/contacts").send({ name: "Jane Doe", email: "jane@example.com", company: "Example Co", tags: ["enterprise"] }).expect(201);
    contactId = res.body.contact.id;
    expect(res.body.contact).toMatchObject({ name: "Jane Doe", email: "jane@example.com", company: "Example Co", tags: ["enterprise"] });
    expect(res.body.contact.owner.id).toBe(ctx.memberId);
  });

  it("validates input", async () => {
    const res = await ctx.member.post("/api/contacts").send({ name: "", email: "not-an-email" }).expect(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("lists, reads and updates the contact", async () => {
    const list = await ctx.member.get("/api/contacts?q=jane").expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].id).toBe(contactId);

    const read = await ctx.member.get(`/api/contacts/${contactId}`).expect(200);
    expect(read.body.contact.name).toBe("Jane Doe");
    expect(read.body).toHaveProperty("deals");
    expect(read.body).toHaveProperty("notes");

    const upd = await ctx.member.patch(`/api/contacts/${contactId}`).send({ phone: "+1 555 0100", tags: ["enterprise", "vip"] }).expect(200);
    expect(upd.body.contact.phone).toBe("+1 555 0100");
    expect(upd.body.contact.tags).toEqual(["enterprise", "vip"]);
  });

  it("admin sees member records; another member cannot", async () => {
    const asAdmin = await ctx.admin.get(`/api/contacts/${contactId}`).expect(200);
    expect(asAdmin.body.contact.id).toBe(contactId);

    const adminOwned = await ctx.admin.post("/api/contacts").send({ name: "Admin Only", email: "ao@example.com" }).expect(201);
    await ctx.member.get(`/api/contacts/${adminOwned.body.contact.id}`).expect(404);
    const memberList = await ctx.member.get("/api/contacts").expect(200);
    expect(memberList.body.items.map((c: { id: string }) => c.id)).not.toContain(adminOwned.body.contact.id);
    const adminList = await ctx.admin.get("/api/contacts").expect(200);
    expect(adminList.body.total).toBe(2);
  });

  it("creates a deal for the contact and scores it automatically in the background", async () => {
    const res = await ctx.member.post("/api/deals").send({ title: "Jane - Pilot", contact: contactId, value: 25000, stage: "Proposal" }).expect(201);
    const dealId = res.body.deal.id;
    expect(res.body.deal.stage).toBe("Proposal");

    await ctx.member.post("/api/notes").send({ deal: dealId, kind: "call", content: "Great call, Jane is excited and budget approved. Moving forward next week." }).expect(201);
    await ctx.queue.waitForIdle();

    const deal = await ctx.member.get(`/api/deals/${dealId}`).expect(200);
    expect(deal.body.deal.score).toBeGreaterThan(50);
    expect(deal.body.deal.scoreBreakdown).toMatchObject({ stagePrior: 45, recency: 12 });
    expect(deal.body.deal.scoreBreakdown.inputs.sentimentSamples).toBe(1);
    expect(deal.body.notes.some((n: { kind: string; sentiment: { label: string } | null }) => n.kind === "call" && n.sentiment?.label === "positive")).toBe(true);
    expect(deal.body.deal.risk).toMatchObject({ atRisk: false });

    // A stage change is logged to the timeline and triggers re-scoring.
    await ctx.member.patch(`/api/deals/${dealId}`).send({ stage: "Negotiation" }).expect(200);
    await ctx.queue.waitForIdle();
    const after = await ctx.member.get(`/api/deals/${dealId}`).expect(200);
    expect(after.body.deal.scoreBreakdown.stagePrior).toBe(60);
    expect(after.body.notes.some((n: { kind: string; content: string }) => n.kind === "system" && /Lead|Proposal.*Negotiation/.test(n.content))).toBe(true);

    const stored = await Deal.findById(dealId).lean();
    expect(stored?.scoreInputHash).toBeTruthy();
  });

  it("deletes the contact and cascades", async () => {
    await ctx.member.delete(`/api/contacts/${contactId}`).expect(200);
    await ctx.member.get(`/api/contacts/${contactId}`).expect(404);
    expect(await Deal.countDocuments({ contact: contactId })).toBe(0);
  });
});
