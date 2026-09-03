import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";
import { AI_FEATURES } from "@loom/shared";

/** One row per AI call (including cache hits and failures) for cost auditing. */
const aiUsageSchema = new Schema(
  {
    feature: { type: String, enum: AI_FEATURES, required: true, index: true },
    provider: { type: String, required: true },
    model: { type: String, required: true },
    status: { type: String, enum: ["ok", "cached", "error", "timeout", "fallback", "circuit_open", "refused"], required: true },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    cacheReadTokens: { type: Number, default: 0 },
    cacheWriteTokens: { type: Number, default: 0 },
    estCostUsd: { type: Number, default: 0 },
    latencyMs: { type: Number, default: 0 },
    error: { type: String, default: null },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    refType: { type: String, default: null },
    refId: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
aiUsageSchema.index({ createdAt: -1 });

export type AiUsageAttrs = InferSchemaType<typeof aiUsageSchema>;
export const AiUsage = model("AiUsage", aiUsageSchema);

/** Response cache so identical prompts (same feature + inputs) are not re-billed. */
const aiCacheSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    feature: { type: String, required: true },
    value: { type: Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false },
);
aiCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type AiCacheDoc = HydratedDocument<InferSchemaType<typeof aiCacheSchema>>;
export const AiCache = model("AiCache", aiCacheSchema);

/**
 * Local vector store used when Pinecone is not configured.
 *
 * Vectors are stored as packed Float32 (`vec`) rather than an array of BSON doubles:
 * a 384-dim vector costs 1.5 KB instead of ~3 KB, and skips per-element decoding on
 * read, which is where the time actually goes. `vector` is retained so rows written
 * by an earlier version still load.
 */
const noteEmbeddingSchema = new Schema(
  {
    note: { type: Schema.Types.ObjectId, ref: "Note", required: true },
    model: { type: String, required: true },
    dims: { type: Number, required: true },
    vec: { type: Buffer, default: null },
    vector: { type: [Number], default: undefined },
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    deal: { type: Schema.Types.ObjectId, ref: "Deal", default: null },
    contact: { type: Schema.Types.ObjectId, ref: "Contact", default: null },
  },
  { timestamps: true },
);
noteEmbeddingSchema.index({ note: 1, model: 1 }, { unique: true });
noteEmbeddingSchema.index({ model: 1 });

export const NoteEmbedding = model("NoteEmbedding", noteEmbeddingSchema);

/**
 * What the assistant was asked and what came back.
 *
 * Kept per user so the Ask page can show a thread rather than forgetting every
 * question the moment it is answered. Only the exchange is stored, never the
 * rows it returned: those change, and a stale copy would be worse than
 * re-running the question.
 *
 * Trimmed by a TTL index rather than growing forever.
 */
const assistantExchangeSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    message: { type: String, required: true },
    kind: { type: String, enum: ["answer", "record", "guide", "refused", "applied"], required: true },
    summary: { type: String, default: "" },
    /** Applied action descriptions, so history shows what actually changed. */
    applied: { type: [String], default: [] },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
assistantExchangeSchema.index({ owner: 1, createdAt: -1 });
assistantExchangeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type AssistantExchangeDoc = HydratedDocument<InferSchemaType<typeof assistantExchangeSchema>>;
export const AssistantExchange = model("AssistantExchange", assistantExchangeSchema);
