import type { IncomingMessage, ServerResponse } from "node:http";

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
 *
 * Nothing is imported at module scope on purpose. A throw while the module
 * graph loads happens before any handler exists, so the platform can only
 * report a generic invocation failure with no cause attached. Loading the app
 * inside the try below turns that same failure into a readable response and a
 * logged stack.
 */

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void;

let booting: Promise<NodeHandler> | null = null;

async function boot(): Promise<NodeHandler> {
  const [{ createApp }, { getProvider }, { connectDb }, { startJobs }, { logger }] = await Promise.all([
    import("../src/app"),
    import("../src/ai/provider"),
    import("../src/db/connect"),
    import("../src/jobs"),
    import("../src/lib/logger"),
  ]);

  await connectDb();
  getProvider();

  // With the inline adapter this only registers the handler; there is no worker
  // to start and no repeatable to schedule.
  await startJobs();

  logger.info("API ready (serverless)");
  return createApp() as unknown as NodeHandler;
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

    const error = err instanceof Error ? err : new Error(String(err));
    console.error("Serverless boot failed:", error.stack ?? error.message);

    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        error: "API failed to start",
        // Without this the platform reports only FUNCTION_INVOCATION_FAILED,
        // which says nothing about which variable or module is at fault.
        detail: error.message,
      }),
    );
  }
}
