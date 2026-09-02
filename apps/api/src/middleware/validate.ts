import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

/** Replaces req.body with the parsed (and defaulted) value. */
export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) return next(result.error);
    req.body = result.data;
    next();
  };
}

/** Express 5 exposes req.query as a getter, so the parsed query lives on res.locals.query. */
export function validateQuery<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query ?? {});
    if (!result.success) return next(result.error);
    res.locals.query = result.data;
    next();
  };
}

export function parsedQuery<T>(res: Response): T {
  return res.locals.query as T;
}

/** Express 5 types route params as string | string[]; we only ever declare single-segment params. */
export function idParam(req: Request, name = "id"): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : String(value ?? "");
}
