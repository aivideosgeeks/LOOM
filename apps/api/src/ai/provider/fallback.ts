import { logger } from "../../lib/logger";
import { AiUnavailableError, type LlmProvider, type StructuredRequest, type StructuredResponse } from "./types";

/**
 * Tries several providers in order and returns the first usable answer.
 *
 * Free model tiers are unreliable in specific ways: a model is retired and the
 * endpoint starts returning 404, or the daily token allowance runs out and it
 * returns 429. Both leave the other provider perfectly able to answer, so
 * failing the whole feature over to its deterministic fallback is a worse
 * outcome than simply asking someone else.
 *
 * A refusal is not a failure. If a provider answers and declines the request,
 * that is the model's considered response and asking a second one would just be
 * shopping for a more permissive answer, so it is returned as-is.
 */
export class FallbackProvider implements LlmProvider {
  /** Index of whichever provider answered last, so status and usage rows name the one actually used. */
  private active = 0;

  constructor(private readonly providers: LlmProvider[]) {
    if (providers.length === 0) throw new Error("FallbackProvider needs at least one provider");
  }

  get name() {
    return this.providers[this.active]!.name;
  }

  get model() {
    return this.providers[this.active]!.model;
  }

  get label() {
    const current = this.providers[this.active]!;
    const others = this.providers.length - 1;
    const own = current.label ?? current.name;
    return others > 0 ? `${own} (+${others} fallback${others > 1 ? "s" : ""})` : own;
  }

  get configured() {
    return this.providers.some((p) => p.configured);
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    let last: unknown;

    for (let i = 0; i < this.providers.length; i += 1) {
      const provider = this.providers[i]!;
      if (!provider.configured) continue;

      try {
        const result = await provider.generateStructured<T>(req);
        if (i !== this.active) {
          this.active = i;
          logger.info({ provider: provider.label ?? provider.name, model: provider.model }, "AI provider failover");
        }
        return result;
      } catch (err) {
        last = err;
        const isLast = i === this.providers.length - 1;
        if (isLast) break;
        logger.warn(
          {
            provider: provider.label ?? provider.name,
            reason: err instanceof AiUnavailableError ? err.reason : "unknown",
            message: err instanceof Error ? err.message : String(err),
          },
          "AI provider failed; trying the next one",
        );
      }
    }

    // Every provider failed, so surface the last error and let the gateway do
    // what it always does: log the usage row and degrade the feature.
    throw last instanceof AiUnavailableError
      ? last
      : new AiUnavailableError("provider_error", last instanceof Error ? last.message : String(last));
  }
}
