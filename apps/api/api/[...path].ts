import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../src/app";
import { getProvider } from "../src/ai/provider";
import { connectDb } from "../src/db/connect";
import { startJobs } from "../src/jobs";
import { logger } from "../src/lib/logger";

/**
 * Serverless entry point for the API.
 *
 * `src/index.ts` is still the way this runs locally and on any host with a real
 * process: it listens on a port, owns a background worker and shuts down on a
 * signal. None of that applies here, where the platform owns the socket and
 * freezes the process between requests, so this file does the same setup minus
 * the parts that assume a lifetime.
 *
 * The filename is a catch-all so the platform routes every /api/* path to this
 * one function while preserving the original URL, which is what lets the Express
 * routers match unchanged.
 */

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let booting: Promise<Handler> | null = null;

async function boot(): Promise<Handler> {
  await connectDb();
  getProvider();

  // With the inline adapter this only registers the handler; there is no worker
  // to start and no repeatable to schedule.
  await startJobs();

  logger.info("API ready (serverless)");
  return createApp() as unknown as Handler;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    // Cached so a warm invocation reuses the existing Mongo connection rather
    // than opening another one per request.
    const app = await (booting ??= boot());
    app(req, res);
  } catch (err) {
    // A failed boot must not be cached, or one transient database error would
    // poison the container for the rest of its life.
    booting = null;
    logger.error({ err }, "Serverless boot failed");
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Service unavailable" }));
  }
}
