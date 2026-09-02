import path from "node:path";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { AiUsage } from "../../models";
import { estimateEmbeddingCostUsd } from "../costs";

export type EmbedKind = "document" | "query";

export interface EmbeddingProvider {
  readonly name: "local" | "voyage" | "openai" | "none";
  readonly model: string;
  /** Resolves true when the provider can embed (model loaded / key present). Never throws. */
  ready(): Promise<boolean>;
  embed(texts: string[], kind: EmbedKind): Promise<number[][]>;
}

class NoneProvider implements EmbeddingProvider {
  readonly name = "none" as const;
  readonly model = "none";
  async ready() {
    return false;
  }
  async embed(): Promise<number[][]> {
    throw new Error("Embeddings disabled");
  }
}

/** Runs a small sentence-transformer in-process (ONNX) so semantic search works with zero API keys. */
class LocalProvider implements EmbeddingProvider {
  readonly name = "local" as const;
  readonly model: string;
  private loader: Promise<((texts: string[], opts: Record<string, unknown>) => Promise<{ tolist(): number[][] }>) | null> | null = null;

  constructor(model: string) {
    this.model = model;
  }

  private load() {
    if (!this.loader) {
      this.loader = (async () => {
        try {
          const started = Date.now();
          const tf = await import("@huggingface/transformers");
          tf.env.cacheDir = path.resolve(process.cwd(), env.TRANSFORMERS_CACHE_DIR);
          tf.env.allowLocalModels = true;
          const extractor = await tf.pipeline("feature-extraction", this.model);
          logger.info({ model: this.model, ms: Date.now() - started }, "Local embedding model loaded");
          return extractor as unknown as (texts: string[], opts: Record<string, unknown>) => Promise<{ tolist(): number[][] }>;
        } catch (err) {
          logger.error({ err }, "Failed to load local embedding model; semantic search will use text fallback");
          this.loader = null;
          return null;
        }
      })();
    }
    return this.loader;
  }

  async ready() {
    return (await this.load()) !== null;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const extractor = await this.load();
    if (!extractor) throw new Error("Local embedding model unavailable");
    const out = await extractor(texts, { pooling: "mean", normalize: true });
    return out.tolist();
  }
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs = 20_000): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${url} responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function logEmbeddingUsage(provider: string, model: string, tokens: number, latencyMs: number, error: string | null) {
  try {
    await AiUsage.create({
      feature: "semantic_search",
      provider,
      model,
      status: error ? "error" : "ok",
      inputTokens: tokens,
      estCostUsd: estimateEmbeddingCostUsd(model, tokens),
      latencyMs,
      error,
    });
  } catch (err) {
    logger.warn({ err }, "Failed to log embedding usage");
  }
}

class VoyageProvider implements EmbeddingProvider {
  readonly name = "voyage" as const;
  constructor(
    private apiKey: string,
    readonly model: string,
  ) {}
  async ready() {
    return true;
  }
  async embed(texts: string[], kind: EmbedKind): Promise<number[][]> {
    const started = Date.now();
    try {
      const json = await postJson("https://api.voyageai.com/v1/embeddings", { authorization: `Bearer ${this.apiKey}` }, { input: texts, model: this.model, input_type: kind });
      void logEmbeddingUsage("voyage", this.model, json.usage?.total_tokens ?? 0, Date.now() - started, null);
      return (json.data as Array<{ embedding: number[] }>).map((d) => d.embedding);
    } catch (err) {
      void logEmbeddingUsage("voyage", this.model, 0, Date.now() - started, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }
}

class OpenAIProvider implements EmbeddingProvider {
  readonly name = "openai" as const;
  constructor(
    private apiKey: string,
    readonly model: string,
  ) {}
  async ready() {
    return true;
  }
  async embed(texts: string[]): Promise<number[][]> {
    const started = Date.now();
    try {
      const json = await postJson("https://api.openai.com/v1/embeddings", { authorization: `Bearer ${this.apiKey}` }, { input: texts, model: this.model });
      void logEmbeddingUsage("openai", this.model, json.usage?.total_tokens ?? 0, Date.now() - started, null);
      return (json.data as Array<{ embedding: number[] }>).map((d) => d.embedding);
    } catch (err) {
      void logEmbeddingUsage("openai", this.model, 0, Date.now() - started, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }
}

let provider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (provider) return provider;
  const choice = env.EMBEDDINGS_PROVIDER;
  if (choice === "none") provider = new NoneProvider();
  else if (choice === "voyage" || (choice === "auto" && env.VOYAGE_API_KEY)) provider = new VoyageProvider(env.VOYAGE_API_KEY ?? "", env.VOYAGE_MODEL);
  else if (choice === "openai" || (choice === "auto" && env.OPENAI_API_KEY)) provider = new OpenAIProvider(env.OPENAI_API_KEY ?? "", env.OPENAI_EMBEDDING_MODEL);
  else provider = new LocalProvider(env.LOCAL_EMBEDDING_MODEL);
  logger.info({ provider: provider.name, model: provider.model }, "Embedding provider selected");
  return provider;
}

/** Test hook. */
export function setEmbeddingProvider(p: EmbeddingProvider | null) {
  provider = p;
}
