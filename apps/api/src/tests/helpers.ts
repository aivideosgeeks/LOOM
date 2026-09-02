import bcrypt from "bcryptjs";
import request from "supertest";
import { createApp } from "../app";
import { connectDb, type DbHandle } from "../db/connect";
import { handleJob } from "../jobs/handlers";
import { MemoryQueue } from "../jobs/memoryQueue";
import { setQueue } from "../jobs/queue";
import { User } from "../models";

export interface TestContext {
  db: DbHandle;
  queue: MemoryQueue;
  app: ReturnType<typeof createApp>;
  admin: request.Agent;
  member: request.Agent;
  adminId: string;
  memberId: string;
}

export async function setupTestContext(): Promise<TestContext> {
  const db = await connectDb({ dbName: `test-${Date.now()}` });
  const queue = new MemoryQueue(4);
  setQueue(queue);
  await queue.start(handleJob);
  const app = createApp();

  const passwordHash = await bcrypt.hash("password123", 4);
  const [adminUser, memberUser] = await User.create([
    { name: "Test Admin", email: "admin@test.dev", passwordHash, role: "admin" },
    { name: "Test Member", email: "member@test.dev", passwordHash, role: "member" },
  ]);

  const admin = request.agent(app);
  await admin.post("/api/auth/login").send({ email: "admin@test.dev", password: "password123" }).expect(200);
  const member = request.agent(app);
  await member.post("/api/auth/login").send({ email: "member@test.dev", password: "password123" }).expect(200);

  return { db, queue, app, admin, member, adminId: String(adminUser._id), memberId: String(memberUser._id) };
}

export async function teardownTestContext(ctx: TestContext) {
  await ctx.queue.close();
  setQueue(null);
  await ctx.db.stop();
}
