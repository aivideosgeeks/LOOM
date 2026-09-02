/**
 * Account lifecycle: first-run setup, invitations, acceptance, roles and removal.
 *
 * These routes create accounts and two of them answer unauthenticated callers, so the
 * guards matter more here than anywhere else in the API.
 */
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { createApp } from "../app";
import { connectDb, type DbHandle } from "../db/connect";
import { handleJob } from "../jobs/handlers";
import { MemoryQueue } from "../jobs/memoryQueue";
import { setQueue } from "../jobs/queue";
import { Contact, Invite, User } from "../models";
import { sha256 } from "../lib/hash";

let db: DbHandle;
let queue: MemoryQueue;
let app: ReturnType<typeof createApp>;

const GOOD_PASSWORD = "correct-horse-9";

beforeAll(async () => {
  db = await connectDb({ dbName: `accounts-${Date.now()}` });
  queue = new MemoryQueue(4);
  setQueue(queue);
  await queue.start(handleJob);
  app = createApp();
});

afterAll(async () => {
  await queue.close();
  setQueue(null);
  await db.stop();
});

afterEach(async () => {
  await Promise.all([User.deleteMany({}), Invite.deleteMany({}), Contact.deleteMany({})]);
});

/** Signs in an agent as a freshly created user of the given role. */
async function makeUser(role: "admin" | "member", email: string, name = "Test Person") {
  const user = await User.create({ name, email, passwordHash: await bcrypt.hash(GOOD_PASSWORD, 4), role });
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ email, password: GOOD_PASSWORD }).expect(200);
  return { user, agent };
}

describe("first-run setup", () => {
  it("reports that a brand new instance needs setup", async () => {
    const res = await request(app).get("/api/auth/setup-state").expect(200);
    expect(res.body.needsSetup).toBe(true);
  });

  it("creates the first account as an administrator and signs them in", async () => {
    const agent = request.agent(app);
    const res = await agent.post("/api/auth/setup").send({ name: "Founder", email: "founder@company.com", password: GOOD_PASSWORD }).expect(201);
    expect(res.body.user).toMatchObject({ email: "founder@company.com", role: "admin" });
    expect(res.headers["set-cookie"][0]).toMatch(/crm_token=/);
    // Already signed in, no second login needed.
    await agent.get("/api/auth/me").expect(200);
  });

  it("refuses a second setup once an account exists", async () => {
    await request(app).post("/api/auth/setup").send({ name: "First", email: "first@company.com", password: GOOD_PASSWORD }).expect(201);

    const res = await request(app).get("/api/auth/setup-state").expect(200);
    expect(res.body.needsSetup).toBe(false);

    await request(app).post("/api/auth/setup").send({ name: "Interloper", email: "evil@elsewhere.com", password: GOOD_PASSWORD }).expect(409);
    expect(await User.countDocuments()).toBe(1);
  });

  it("enforces the password policy and the email format", async () => {
    await request(app).post("/api/auth/setup").send({ name: "A", email: "a@b.com", password: "short1" }).expect(400);
    await request(app).post("/api/auth/setup").send({ name: "A", email: "a@b.com", password: "nodigitsatallhere" }).expect(400);
    await request(app).post("/api/auth/setup").send({ name: "A", email: "not-an-email", password: GOOD_PASSWORD }).expect(400);
    await request(app).post("/api/auth/setup").send({ name: "", email: "a@b.com", password: GOOD_PASSWORD }).expect(400);
    expect(await User.countDocuments()).toBe(0);
  });

  it("survives two setup requests racing", async () => {
    const results = await Promise.all([
      request(app).post("/api/auth/setup").send({ name: "One", email: "one@company.com", password: GOOD_PASSWORD }),
      request(app).post("/api/auth/setup").send({ name: "Two", email: "two@company.com", password: GOOD_PASSWORD }),
    ]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await User.countDocuments()).toBe(1);
  });
});

describe("invitations", () => {
  it("is admin only", async () => {
    const { agent: member } = await makeUser("member", "member@company.com");
    await member.post("/api/auth/invites").send({ email: "new@company.com" }).expect(403);
    await member.get("/api/auth/invites").expect(403);
    await request(app).post("/api/auth/invites").send({ email: "new@company.com" }).expect(401);
  });

  it("issues an invitation with a one-time link and never stores the raw token", async () => {
    const { agent } = await makeUser("admin", "admin@company.com", "Ada Admin");
    const res = await agent.post("/api/auth/invites").send({ email: "New.Person@Company.com", role: "member", name: "New Person" }).expect(201);

    expect(res.body.invite.email).toBe("new.person@company.com");
    expect(res.body.invite.link).toMatch(/\/invite\/[A-Za-z0-9_-]{20,}$/);
    expect(res.body.invite).toHaveProperty("emailed");

    const token = res.body.invite.link.split("/invite/")[1];
    const stored = await Invite.findOne({ email: "new.person@company.com" }).lean();
    expect(stored!.tokenHash).toBe(sha256(token));
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it("refuses to invite an address that already has an account", async () => {
    const { agent } = await makeUser("admin", "admin@company.com");
    await agent.post("/api/auth/invites").send({ email: "admin@company.com" }).expect(409);
  });

  it("validates the address and role", async () => {
    const { agent } = await makeUser("admin", "admin@company.com");
    await agent.post("/api/auth/invites").send({ email: "nope" }).expect(400);
    await agent.post("/api/auth/invites").send({ email: "x@y.com", role: "superuser" }).expect(400);
    await agent.post("/api/auth/invites").send({}).expect(400);
  });

  it("lists pending invitations and drops them once accepted", async () => {
    const { agent } = await makeUser("admin", "admin@company.com");
    await agent.post("/api/auth/invites").send({ email: "a@company.com" }).expect(201);
    const created = await agent.post("/api/auth/invites").send({ email: "b@company.com" }).expect(201);

    const list = await agent.get("/api/auth/invites").expect(200);
    expect(list.body.invites).toHaveLength(2);
    expect(list.body.invites[0]).not.toHaveProperty("tokenHash");
    // The link is returned only at creation, never when listing.
    expect(list.body.invites.every((i: { link?: string }) => i.link === undefined)).toBe(true);

    const token = created.body.invite.link.split("/invite/")[1];
    await request(app).post(`/api/auth/invites/${token}/accept`).send({ name: "B", password: GOOD_PASSWORD }).expect(201);

    const after = await agent.get("/api/auth/invites").expect(200);
    expect(after.body.invites).toHaveLength(1);
  });

  it("resending replaces the previous link", async () => {
    const { agent } = await makeUser("admin", "admin@company.com");
    const first = await agent.post("/api/auth/invites").send({ email: "person@company.com" }).expect(201);
    const firstToken = first.body.invite.link.split("/invite/")[1];

    const list = await agent.get("/api/auth/invites").expect(200);
    const resent = await agent.post(`/api/auth/invites/${list.body.invites[0].id}/resend`).expect(200);
    const secondToken = resent.body.invite.link.split("/invite/")[1];

    expect(secondToken).not.toBe(firstToken);
    await request(app).get(`/api/auth/invites/${firstToken}`).expect(404);
    await request(app).get(`/api/auth/invites/${secondToken}`).expect(200);
    expect(await Invite.countDocuments({ acceptedAt: null })).toBe(1);
  });

  it("revoking makes the link stop working", async () => {
    const { agent } = await makeUser("admin", "admin@company.com");
    const created = await agent.post("/api/auth/invites").send({ email: "person@company.com" }).expect(201);
    const token = created.body.invite.link.split("/invite/")[1];
    const list = await agent.get("/api/auth/invites").expect(200);

    await agent.delete(`/api/auth/invites/${list.body.invites[0].id}`).expect(200);
    await request(app).get(`/api/auth/invites/${token}`).expect(404);
    await request(app).post(`/api/auth/invites/${token}/accept`).send({ name: "X", password: GOOD_PASSWORD }).expect(400);
    expect(await User.countDocuments()).toBe(1);
  });
});

describe("accepting an invitation", () => {
  async function invited(role: "admin" | "member" = "member") {
    const { agent } = await makeUser("admin", "admin@company.com", "Ada Admin");
    const created = await agent.post("/api/auth/invites").send({ email: "joiner@company.com", role, name: "Jo Joiner" }).expect(201);
    return { adminAgent: agent, token: created.body.invite.link.split("/invite/")[1] };
  }

  it("shows the invitee who invited them and as what, without leaking anything else", async () => {
    const { token } = await invited();
    const res = await request(app).get(`/api/auth/invites/${token}`).expect(200);
    expect(res.body.invite).toEqual({ email: "joiner@company.com", role: "member", name: "Jo Joiner", invitedByName: "Ada Admin" });
    expect(JSON.stringify(res.body)).not.toMatch(/tokenHash|passwordHash/);
  });

  it("creates the account with the invited role and signs them straight in", async () => {
    const { token } = await invited("admin");
    const agent = request.agent(app);
    const res = await agent.post(`/api/auth/invites/${token}/accept`).send({ name: "Jo Joiner", password: GOOD_PASSWORD }).expect(201);

    expect(res.body.user).toMatchObject({ email: "joiner@company.com", role: "admin", name: "Jo Joiner" });
    const me = await agent.get("/api/auth/me").expect(200);
    expect(me.body.user.email).toBe("joiner@company.com");

    // The chosen password works on a fresh sign-in.
    const fresh = request.agent(app);
    await fresh.post("/api/auth/login").send({ email: "joiner@company.com", password: GOOD_PASSWORD }).expect(200);
  });

  it("a token works exactly once", async () => {
    const { token } = await invited();
    await request(app).post(`/api/auth/invites/${token}/accept`).send({ name: "Jo", password: GOOD_PASSWORD }).expect(201);
    await request(app).post(`/api/auth/invites/${token}/accept`).send({ name: "Impostor", password: GOOD_PASSWORD }).expect(400);
    expect(await User.countDocuments({ email: "joiner@company.com" })).toBe(1);
  });

  it("rejects unknown, malformed and expired tokens", async () => {
    await request(app).get("/api/auth/invites/nope").expect(404);
    await request(app).get(`/api/auth/invites/${"a".repeat(43)}`).expect(404);
    await request(app).post("/api/auth/invites/short/accept").send({ name: "X", password: GOOD_PASSWORD }).expect(400);

    const { token } = await invited();
    await Invite.updateOne({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await request(app).get(`/api/auth/invites/${token}`).expect(404);
    await request(app).post(`/api/auth/invites/${token}/accept`).send({ name: "X", password: GOOD_PASSWORD }).expect(400);
    expect(await User.countDocuments({ email: "joiner@company.com" })).toBe(0);
  });

  it("enforces the password policy on acceptance", async () => {
    const { token } = await invited();
    await request(app).post(`/api/auth/invites/${token}/accept`).send({ name: "Jo", password: "tiny1" }).expect(400);
    await request(app).post(`/api/auth/invites/${token}/accept`).send({ name: "Jo", password: "allletterspassword" }).expect(400);
    await request(app).post(`/api/auth/invites/${token}/accept`).send({ name: "", password: GOOD_PASSWORD }).expect(400);
    expect(await User.countDocuments({ email: "joiner@company.com" })).toBe(0);
    // The invitation is still usable after a rejected attempt.
    await request(app).post(`/api/auth/invites/${token}/accept`).send({ name: "Jo", password: GOOD_PASSWORD }).expect(201);
  });

  it("the invitee cannot choose their own email address or role", async () => {
    const { token } = await invited("member");
    const res = await request(app)
      .post(`/api/auth/invites/${token}/accept`)
      .send({ name: "Jo", password: GOOD_PASSWORD, email: "someone.else@company.com", role: "admin" })
      .expect(201);
    expect(res.body.user).toMatchObject({ email: "joiner@company.com", role: "member" });
  });
});

describe("managing people", () => {
  it("changes a role, and refuses to strip the last administrator", async () => {
    const { agent, user: admin } = await makeUser("admin", "admin@company.com");
    const { user: member } = await makeUser("member", "member@company.com");

    const promoted = await agent.patch(`/api/auth/users/${member._id}/role`).send({ role: "admin" }).expect(200);
    expect(promoted.body.user.role).toBe("admin");

    // Now two admins exist, so demoting the other one is allowed.
    await agent.patch(`/api/auth/users/${member._id}/role`).send({ role: "member" }).expect(200);
    // And the last admin cannot demote themselves.
    await agent.patch(`/api/auth/users/${admin._id}/role`).send({ role: "member" }).expect(400);
    expect((await User.findById(admin._id))!.role).toBe("admin");
  });

  it("refuses to remove someone who still owns records", async () => {
    const { agent } = await makeUser("admin", "admin@company.com");
    const { user: member } = await makeUser("member", "member@company.com");
    await Contact.create({ name: "Owned", owner: member._id });

    const res = await agent.delete(`/api/auth/users/${member._id}`).expect(400);
    expect(res.body.error).toMatch(/still owns 1 contacts/i);
    expect(await User.findById(member._id)).not.toBeNull();

    const owned = await agent.get(`/api/auth/users/${member._id}/owned`).expect(200);
    expect(owned.body.owned).toMatchObject({ contacts: 1, total: 1 });

    await Contact.deleteMany({});
    await agent.delete(`/api/auth/users/${member._id}`).expect(200);
    expect(await User.findById(member._id)).toBeNull();
  });

  it("refuses to remove yourself or the last administrator", async () => {
    const { agent, user: admin } = await makeUser("admin", "admin@company.com");
    await agent.delete(`/api/auth/users/${admin._id}`).expect(400);
    expect(await User.findById(admin._id)).not.toBeNull();
  });

  it("is admin only", async () => {
    const { user: admin } = await makeUser("admin", "admin@company.com");
    const { agent: member } = await makeUser("member", "member@company.com");
    await member.patch(`/api/auth/users/${admin._id}/role`).send({ role: "member" }).expect(403);
    await member.delete(`/api/auth/users/${admin._id}`).expect(403);
    await member.get(`/api/auth/users/${admin._id}/owned`).expect(403);
  });
});
