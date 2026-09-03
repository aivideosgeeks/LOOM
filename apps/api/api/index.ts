import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../src/app";
import { getProvider } from "../src/ai/provider";
import { connectDb } from "../src/db/connect";
import { startJobs } from "../src/jobs";
import { logger } from "../src/lib/logger";

/**
 * Serverless entry point for the API.
 *
 * `src/index.ts` remains the way this runs anywhere with a real process: it
 * listens on a port, owns a background worker and shuts down on a signal. None
 * of that applies here, where the platform owns the socket and freezes the
 * process between requests, so this does the same setup minus the parts that
 * assume a lifetime.
 *
 * Every path is rewritten to this single function by vercel.json, which keeps
 * the original URL intact so the Express routers match unchanged.
 */

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void;

let booting: Promise<NodeHandler> | null = null;

async function boot(): Promise<NodeHandler> {
  await connectDb();
  getProvider();

  // With the inline adapter this only registers the handler; there is no worker
  // to start and no repeatable to schedule.
  await startJobs();

  logger.info("API ready (serverless)");
  return createApp() as unknown as NodeHandler;
}

function fail(res: ServerResponse, status: number, message: string) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ error: message }));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    // Cached so a warm invocation reuses the open Mongo connection rather than
    // opening a new one per request.
    const app = await (booting ??= boot());
    app(req, res);
  } catch (err) {
    // A failed boot must not stay cached, or one transient database error would
    // poison the container for the rest of its life.
    booting = null;
    const message = err instanceof Error ? err.message : "Unknown startup error";
    logger.error({ err }, "Serverless boot failed");
    // Reported rather than rethrown: an uncaught error here shows up only as a
    // generic invocation failure, which says nothing about the cause.
    fail(res, 503, message);
  }
}
