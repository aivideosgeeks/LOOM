import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import type { Request } from "express";
import { env, isTest } from "../config/env";

const keyByUser = (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? "unknown");

/** Per-user limiter for endpoints that trigger LLM calls. */
export const aiLimiter = rateLimit({
  windowMs: 60_000,
  limit: isTest ? 10_000 : env.AI_RATE_LIMIT_PER_MINUTE,
  keyGenerator: keyByUser,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many AI requests, please slow down.", details: null },
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: isTest ? 10_000 : 20,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many login attempts, try again later.", details: null },
});

/**
 * Guards the unauthenticated account routes: first-run setup and invitation links.
 * Tighter than login, because these create accounts and a token is guessable in principle.
 */
export const setupLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: isTest ? 10_000 : 30,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts, try again later.", details: null },
});
