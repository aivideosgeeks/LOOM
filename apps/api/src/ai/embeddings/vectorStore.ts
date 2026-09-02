import { Types } from "mongoose";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { NoteEmbedding } from "../../models";

export interface VectorItem {
  id: string;
  vector: number[];
  metadata: { owner: string; deal: string | null; contact: string | null };
}

export interface VectorQueryFilter {
  owner?: string;
}

export interface VectorStore {
  readonly name: "pinecone" | "mongo";
  upsert(model: string, items: VectorItem[]): Promise<void>;
  query(model: string, vector: number[], topK: number, filter: VectorQueryFilter): Promise<Array<{ id: string; score: number }>>;
  remove(model: string, ids: string[]): Promise<void>;
  healthy(): Promise<boolean>;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Dot product only. Valid when both sides are unit vectors, which every provider here returns. */
function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let d = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) d += a[i] * b[i];
  return d;
}

/**
 * Vectors are L2-normalised on the way in, so ranking is a plain dot product
 * instead of recomputing both magnitudes per comparison. Cosine similarity is
 * scale-invariant, so nothing is lost and scores stay in -1..1.
 */
export function normalize(v: ArrayLike<number>): Float32Array {
  const out = Float32Array.from(v as ArrayLike<number>);
  let sum = 0;
  for (let i = 0; i < out.length; i += 1) sum += out[i] * out[i];
  const norm = Math.sqrt(sum);
  if (norm > 0) for (let i = 0; i < out.length; i += 1) out[i] /= norm;
  return out;
}

export function packVector(v: number[]): Buffer {
  const f32 = normalize(v);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

/**
 * A lean() read returns BSON `Binary`, not a Node Buffer, so accept either. The bytes
 * are copied into a fresh ArrayBuffer because a Float32Array view requires a 4-byte
 * aligned offset, and a pooled Buffer gives no such guarantee.
 */
export function unpackVector(value: unknown): Float32Array | null {
  let bytes: Uint8Array | null = null;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    bytes = value;
  } else if (value && typeof value === "object") {
    const bin = value as { buffer?: unknown; value?: () => unknown };
    if (bin.buffer instanceof Uint8Array) bytes = bin.buffer;
    else if (typeof bin.value === "function") {
      const v = bin.value();
      if (v instanceof Uint8Array) bytes = v;
    }
  }
  if (!bytes || bytes.byteLength < 4) return null;
  const ab = new ArrayBuffer(bytes.byteLength - (bytes.byteLength % 4));
  new Uint8Array(ab).set(bytes.subarray(0, ab.byteLength));
  return new Float32Array(ab);
}

interface CachedVector {
  id: string;
  owner: string;
  vec: Float32Array;
}

/**
 * Vectors in MongoDB, ranked in process.
 *
 * Loading the vectors, not comparing them, is the expensive half: at 6k notes the
 * read cost ~164ms against ~6ms of arithmetic. So vectors are packed as Float32 and
 * held in a per-model cache that is invalidated whenever an embedding is written or
 * removed. Suitable into the low hundreds of thousands of notes; beyond that use
 * Pinecone (set PINECONE_API_KEY) or a database-side vector index.
 */
export class MongoVectorStore implements VectorStore {
  readonly name = "mongo" as const;
  private cache = new Map<string, CachedVector[]>();

  async upsert(model: string, items: VectorItem[]) {
    await Promise.all(
      items.map((item) =>
        NoteEmbedding.updateOne(
          { note: new Types.ObjectId(item.id), model },
          {
            $set: {
              dims: item.vector.length,
              vec: packVector(item.vector),
              owner: new Types.ObjectId(item.metadata.owner),
              deal: item.metadata.deal ? new Types.ObjectId(item.metadata.deal) : null,
              contact: item.metadata.contact ? new Types.ObjectId(item.metadata.contact) : null,
            },
            $unset: { vector: "" },
          },
          { upsert: true },
        ),
      ),
    );
    this.cache.delete(model);
  }

  private async load(model: string): Promise<CachedVector[]> {
    const hit = this.cache.get(model);
    if (hit) return hit;
    const rows = await NoteEmbedding.find({ model }).select("note owner vec vector").lean();
    const loaded: CachedVector[] = [];
    for (const r of rows) {
      const raw = r as unknown as { note: unknown; owner: unknown; vec?: unknown; vector?: number[] | null };
      const vec = raw.vec ? unpackVector(raw.vec) : raw.vector?.length ? normalize(raw.vector) : null;
      if (!vec || !vec.length) continue;
      loaded.push({ id: String(raw.note), owner: String(raw.owner), vec });
    }
    this.cache.set(model, loaded);
    return loaded;
  }

  async query(model: string, vector: number[], topK: number, filter: VectorQueryFilter) {
    const rows = await this.load(model);
    const probe = normalize(vector);
    const scored: Array<{ id: string; score: number }> = [];
    for (const row of rows) {
      if (filter.owner && row.owner !== filter.owner) continue;
      scored.push({ id: row.id, score: dot(probe, row.vec) });
    }
    return scored.sort((x, y) => y.score - x.score).slice(0, topK);
  }

  async remove(model: string, ids: string[]) {
    await NoteEmbedding.deleteMany({ model, note: { $in: ids.map((id) => new Types.ObjectId(id)) } });
    this.cache.delete(model);
  }

  async healthy() {
    return true;
  }

  /** Test hook: drop the in-process cache. */
  invalidate() {
    this.cache.clear();
  }
}

export class PineconeVectorStore implements VectorStore {
  readonly name = "pinecone" as const;
  private indexPromise: Promise<any> | null = null;

  constructor(
    private apiKey: string,
    private indexName: string,
  ) {}

  private async index() {
    if (!this.indexPromise) {
      this.indexPromise = (async () => {
        const { Pinecone } = await import("@pinecone-database/pinecone");
        const pc = new Pinecone({ apiKey: this.apiKey });
        return pc.index({ name: this.indexName });
      })();
    }
    return this.indexPromise;
  }

  async upsert(model: string, items: VectorItem[]) {
    const idx = await this.index();
    await idx.namespace(model).upsert({
      records: items.map((i) => ({
        id: i.id,
        values: i.vector,
        metadata: { owner: i.metadata.owner, deal: i.metadata.deal ?? "", contact: i.metadata.contact ?? "" },
      })),
    });
  }

  async query(model: string, vector: number[], topK: number, filter: VectorQueryFilter) {
    const idx = await this.index();
    const res = await idx.namespace(model).query({
      vector,
      topK,
      includeMetadata: false,
      ...(filter.owner ? { filter: { owner: { $eq: filter.owner } } } : {}),
    });
    return (res.matches ?? []).map((m: { id: string; score?: number }) => ({ id: m.id, score: m.score ?? 0 }));
  }

  async remove(model: string, ids: string[]) {
    const idx = await this.index();
    await idx.namespace(model).deleteMany({ ids });
  }

  async healthy() {
    try {
      const idx = await this.index();
      await idx.describeIndexStats();
      return true;
    } catch (err) {
      logger.warn({ err }, "Pinecone health check failed");
      return false;
    }
  }
}

let store: VectorStore | null = null;

export function getVectorStore(): VectorStore {
  if (!store) {
    store = env.PINECONE_API_KEY && env.PINECONE_INDEX ? new PineconeVectorStore(env.PINECONE_API_KEY, env.PINECONE_INDEX) : new MongoVectorStore();
    logger.info({ store: store.name }, "Vector store selected");
  }
  return store;
}

export function setVectorStore(s: VectorStore | null) {
  store = s;
}
