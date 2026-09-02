import type { ZodType } from "zod";
import type { AiFeature } from "@loom/shared";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { sha256 } from "../lib/hash";
import { AiCache, AiUsage } from "../models";
import { estimateCostUsd } from "./costs";
import { PROMPT_VERSION } from "./prompts";
import { AiUnavailableError, getProvider, type Effort, type UsageInfo } from "./provider";

/**
 * Single choke point for every LLM call in the app.
 *
 *  - response cache (Mongo, TTL per feature) so unchanged inputs are never re-billed
 *  - circuit breaker: after N consecutive provider failures, fail fast for a cool-down window
 *  - concurrency cap so a burst of background jobs cannot exhaust provider rate limits
 *  - hard deadline on top of the SDK timeout
 *  - one AiUsage row per call (ok / cached / error / timeout / fallback / circuit_open / refused)
 *
 * Callers always receive a result object, never an exception, so an AI outage can only ever
 * degrade a feature to its fallback path.
 */

export type AiFailureReason = "not_configured" | "timeout" | "circuit_open" | "provider_error" | "invalid_output" | "refused";

export type StructuredResult<T> =
  | { ok: true; data: T; cached: boolean; usage: UsageInfo | null }
  | { ok: false; reason: AiFailureReason; message: string };

export interface StructuredCallOptions<T> {
  feature: AiFeature;
  schema: ZodType<T>;
  system: string;
  user: string;
  effort?: Effort;
  maxTokens?: number;
  timeoutMs?: number;
  /** Cache key material (already specific to the inputs) and TTL. Omit to skip caching. */
  cache?: { key: string; ttlMs: number } | null;
  userId?: string | null;
  ref?: { type: string; id: string } | null;
}

class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private trialInFlight = false;

  constructor(
    private threshold: number,
    private openMs: number,
  ) {}

  state(): "closed" | "open" | "half_open" {
    if (this.openedAt === null) return "closed";
    return Date.now() - this.openedAt >= this.openMs ? "half_open" : "open";
  }

  canPass(): boolean {
    const s = this.state();
    if (s === "closed") return true;
    if (s === "half_open" && !this.trialInFlight) {
      this.trialInFlight = true;
      return true;
    }
    return false;
  }

  success() {
    this.failures = 0;
    this.openedAt = null;
    this.trialInFlight = false;
  }

  failure() {
    this.failures += 1;
    this.trialInFlight = false;
    if (this.failures >= this.threshold) this.openedAt = Date.now();
  }

  get consecutiveFailures() {
    return this.failures;
  }

  reset() {
    this.success();
  }
}

class Semaphore {
  private active = 0;
  private waiters: Array<() => void> = [];
  constructor(private max: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active += 1;
    } else {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
      this.active += 1;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      const next = this.waiters.shift();
      if (next) next();
    };
  }
}

export const circuit = new CircuitBreaker(env.AI_CIRCUIT_FAILURES, env.AI_CIRCUIT_OPEN_MS);
const semaphore = new Semaphore(env.AI_MAX_CONCURRENCY);

type UsageStatus = "ok" | "cached" | "error" | "timeout" | "fallback" | "circuit_open" | "refused";

async function logUsage(
  opts: StructuredCallOptions<unknown>,
  status: UsageStatus,
  usage: UsageInfo | null,
  latencyMs: number,
  error: string | null,
) {
  const provider = getProvider();
  try {
    await AiUsage.create({
      feature: opts.feature,
      provider: provider.label ?? provider.name,
      model: usage?.model ?? provider.model,
      status,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      cacheReadTokens: usage?.cacheReadTokens ?? 0,
      cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
      estCostUsd: usage ? estimateCostUsd(usage.model, usage) : 0,
      latencyMs,
      error,
      user: opts.userId ?? null,
      refType: opts.ref?.type ?? null,
      refId: opts.ref?.id ?? null,
    });
  } catch (err) {
    logger.warn({ err }, "Failed to record AI usage");
  }
}

function cacheKeyFor(opts: StructuredCallOptions<unknown>): string | null {
  if (!opts.cache) return null;
  return sha256({ feature: opts.feature, promptVersion: PROMPT_VERSION, model: getProvider().model, key: opts.cache.key });
}

export async function callStructured<T>(opts: StructuredCallOptions<T>): Promise<StructuredResult<T>> {
  const provider = getProvider();
  const started = Date.now();
  const key = cacheKeyFor(opts);

  if (key) {
    try {
      const hit = await AiCache.findOne({ key, expiresAt: { $gt: new Date() } }).lean();
      if (hit) {
        const parsed = opts.schema.safeParse(hit.value);
        if (parsed.success) {
          await logUsage(opts, "cached", null, Date.now() - started, null);
          return { ok: true, data: parsed.data, cached: true, usage: null };
        }
      }
    } catch (err) {
      logger.warn({ err }, "AI cache lookup failed");
    }
  }

  if (!provider.configured) {
    await logUsage(opts, "fallback", null, 0, "not_configured");
    return { ok: false, reason: "not_configured", message: "No AI provider configured." };
  }

  if (!circuit.canPass()) {
    await logUsage(opts, "circuit_open", null, 0, "circuit_open");
    return { ok: false, reason: "circuit_open", message: "AI provider temporarily unavailable (circuit open)." };
  }

  const timeoutMs = opts.timeoutMs ?? env.AI_TIMEOUT_MS;
  const release = await semaphore.acquire();
  let timer: NodeJS.Timeout | null = null;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AiUnavailableError("timeout", "AI call exceeded hard deadline.")), timeoutMs * 2 + 2_000);
    });
    const response = await Promise.race([
      provider.generateStructured<T>({
        schema: opts.schema,
        system: opts.system,
        user: opts.user,
        effort: opts.effort ?? "medium",
        maxTokens: opts.maxTokens ?? 8192,
        timeoutMs,
      }),
      deadline,
    ]);

    if (response.refused) {
      circuit.success();
      await logUsage(opts, "refused", response.usage, Date.now() - started, response.message);
      return { ok: false, reason: "refused", message: response.message };
    }

    const parsed = opts.schema.safeParse(response.data);
    if (!parsed.success) {
      circuit.success();
      await logUsage(opts, "error", response.usage, Date.now() - started, "schema_mismatch");
      return { ok: false, reason: "invalid_output", message: "Model output failed validation." };
    }

    circuit.success();
    await logUsage(opts, "ok", response.usage, Date.now() - started, null);

    if (key && opts.cache) {
      try {
        await AiCache.updateOne(
          { key },
          { $set: { feature: opts.feature, value: parsed.data, expiresAt: new Date(Date.now() + opts.cache.ttlMs) } },
          { upsert: true },
        );
      } catch (err) {
        logger.warn({ err }, "AI cache write failed");
      }
    }
    return { ok: true, data: parsed.data, cached: false, usage: response.usage };
  } catch (error) {
    const err = error instanceof AiUnavailableError ? error : new AiUnavailableError("provider_error", error instanceof Error ? error.message : String(error));
    if (err.countsAsFailure) circuit.failure();
    const status: UsageStatus = err.reason === "timeout" ? "timeout" : "error";
    await logUsage(opts, status, null, Date.now() - started, err.message);
    logger.warn({ feature: opts.feature, reason: err.reason, msg: err.message }, "AI call failed; using fallback");
    return { ok: false, reason: err.reason, message: err.message };
  } finally {
    if (timer) clearTimeout(timer);
    release();
  }
}

export function getGatewayStatus() {
  const provider = getProvider();
  return {
    provider: provider.label ?? provider.name,
    model: provider.model,
    configured: provider.configured,
    circuit: circuit.state(),
    consecutiveFailures: circuit.consecutiveFailures,
  };
}
