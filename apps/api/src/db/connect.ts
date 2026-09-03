import mongoose from "mongoose";
import { importOptional } from "../lib/optionalImport";
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
/**
 * The database named in a connection string, if it has one.
 *
 * Connection strings carry their database in the path, and every hosted
 * provider hands you one shaped that way. Passing dbName unconditionally
 * overrode it, so a URI ending in /loom silently wrote to "crm" instead. An
 * explicit dbName argument still wins, which is what the tests rely on.
 */
function databaseFromUri(uri: string): string | undefined {
  try {
    const path = new URL(uri).pathname.replace(/^\//, "");
    return path.length > 0 ? decodeURIComponent(path) : undefined;
  } catch {
    return undefined;
  }
}

export async function connectDb(opts: { uri?: string; dbName?: string } = {}): Promise<DbHandle> {
  let uri = opts.uri ?? env.MONGODB_URI;
  let memory: { stop: () => Promise<boolean> } | null = null;

  if (!uri) {
    if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
      // The in-memory server is not bundled for serverless, and would be wiped
      // between invocations even if it were. Say so plainly.
      throw new Error("MONGODB_URI is required on a serverless host. Set it in the project's environment variables.");
    }
    const { MongoMemoryServer } = await importOptional<typeof import("mongodb-memory-server")>("mongodb-memory-server");
    const server = await MongoMemoryServer.create({ instance: { dbName: opts.dbName ?? "crm" } });
    memory = server;
    uri = server.getUri();
    if (env.NODE_ENV !== "test") {
      logger.warn("MONGODB_URI not set: using an in-memory MongoDB. Data is lost on restart. Set MONGODB_URI for persistence.");
    }
  }

  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, { dbName: opts.dbName ?? databaseFromUri(uri) ?? "crm" });
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
