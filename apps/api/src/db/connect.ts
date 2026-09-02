import mongoose from "mongoose";
import { env } from "../config/env";
import { logger } from "../lib/logger";

export interface DbHandle {
  uri: string;
  memory: boolean;
  stop: () => Promise<void>;
}

/**
 * Connects to MONGODB_URI when set. Otherwise (local dev / tests) boots an
 * in-process MongoDB via mongodb-memory-server so the app runs with zero setup.
 */
export async function connectDb(opts: { uri?: string; dbName?: string } = {}): Promise<DbHandle> {
  let uri = opts.uri ?? env.MONGODB_URI;
  let memory: { stop: () => Promise<boolean> } | null = null;

  if (!uri) {
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    const server = await MongoMemoryServer.create({ instance: { dbName: opts.dbName ?? "crm" } });
    memory = server;
    uri = server.getUri();
    if (env.NODE_ENV !== "test") {
      logger.warn("MONGODB_URI not set: using an in-memory MongoDB. Data is lost on restart. Set MONGODB_URI for persistence.");
    }
  }

  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, { dbName: opts.dbName ?? "crm" });
  // Make sure text / TTL / unique indexes exist before serving requests ($text queries need the index).
  await import("../models");
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
  logger.info({ memory: !!memory }, "MongoDB connected");

  return {
    uri,
    memory: !!memory,
    stop: async () => {
      await mongoose.disconnect();
      if (memory) await memory.stop();
    },
  };
}
