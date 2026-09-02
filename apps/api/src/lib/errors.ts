import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "./logger";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new HttpError(404, `${what} not found`);
export const forbidden = (msg = "Forbidden") => new HttpError(403, msg);
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details ?? null });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Validation failed", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    return;
  }
  const anyErr = err as { name?: string; message?: string; status?: number; type?: string };
  if (anyErr?.name === "CastError") {
    res.status(400).json({ error: "Invalid identifier", details: null });
    return;
  }
  if (anyErr?.type === "entity.too.large") {
    res.status(413).json({ error: "Request body too large", details: null });
    return;
  }
  logger.error({ err }, "Unhandled error");
  if (process.env.NODE_ENV === "test") console.error("[errorHandler]", err);
  const message = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: "Internal server error", details: process.env.NODE_ENV === "production" ? null : message });
}
