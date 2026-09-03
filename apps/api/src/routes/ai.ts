import { Router } from "express";
import { askSchema, semanticSearchSchema, type AiStatus } from "@loom/shared";
import type { z } from "zod";
import { getEmbeddingProvider } from "../ai/embeddings/provider";
import { semanticSearch } from "../ai/embeddings/semanticSearch";
import { getVectorStore } from "../ai/embeddings/vectorStore";
import { runAssistant } from "../ai/features/assistant";
import { askCrm } from "../ai/features/nlQuery";
import { getGatewayStatus } from "../ai/gateway";
import { requireAuth } from "../middleware/auth";
import { aiLimiter } from "../middleware/rateLimit";
import { parsedQuery, validateBody, validateQuery } from "../middleware/validate";
import { getQueue } from "../jobs/queue";
import { AssistantExchange } from "../models";
import { z as zod } from "zod";

export const aiRouter = Router();
aiRouter.use(requireAuth);

aiRouter.get("/status", async (_req, res) => {
  const gateway = getGatewayStatus();
  const embeddings = getEmbeddingProvider();
  const store = getVectorStore();
  const queue = await getQueue();
  const status: AiStatus = {
    ...gateway,
    embeddings: { provider: embeddings.name, model: embeddings.model, ready: await embeddings.ready() },
    vectorStore: { provider: store.name, healthy: await store.healthy() },
    queue: { provider: queue.provider },
  };
  res.json(status);
});

/** Natural-language query. The model only proposes a typed filter; we validate + execute it. */
aiRouter.post("/ask", aiLimiter, validateBody(askSchema), async (req, res) => {
  const result = await askCrm(req.body.question, req.user!);
  res.status(result.ok ? 200 : 422).json(result);
});

/** Meaning-based search across notes with automatic text-search fallback. */
aiRouter.get("/search", validateQuery(semanticSearchSchema), async (req, res) => {
  const q = parsedQuery<z.infer<typeof semanticSearchSchema>>(res);
  const result = await semanticSearch(q.q, req.user!, q.limit);
  res.json(result);
});

/** History is kept for a month; long enough to be useful, short enough not to accumulate. */
const HISTORY_TTL_MS = 30 * 86_400_000;
const HISTORY_LIMIT = 50;

type ExchangeKind = "answer" | "record" | "guide" | "refused" | "applied";

/** Reply kinds and history kinds line up one to one; this keeps the mapping explicit. */
function historyKind(kind: string): ExchangeKind {
  return (["answer", "record", "guide", "refused", "applied"] as const).includes(kind as ExchangeKind)
    ? (kind as ExchangeKind)
    : "refused";
}

async function record(userId: string, message: string, kind: ExchangeKind, summary: string, applied: string[] = []) {
  await AssistantExchange.create({
    owner: userId,
    message,
    kind,
    summary,
    applied,
    expiresAt: new Date(Date.now() + HISTORY_TTL_MS),
  }).catch(() => undefined); // History is a convenience; losing a row must not fail the request.
}

const assistantSchema = zod.object({ message: zod.string().trim().min(1).max(1000) });

/**
 * The assistant. Answers questions, opens records, explains the product, and
 * carries out changes from the allowlist.
 */
aiRouter.post("/assistant", aiLimiter, validateBody(assistantSchema), async (req, res) => {
  const reply = await runAssistant(req.body.message, req.user!);
  const summary = reply.kind === "refused" ? reply.reason : reply.summary;
  const applied = reply.kind === "applied" ? reply.applied : [];
  await record(req.user!.id, req.body.message, historyKind(reply.kind), summary, applied);
  res.json(reply);
});

/** Past exchanges for the signed-in user, newest first. */
aiRouter.get("/assistant/history", async (req, res) => {
  const rows = await AssistantExchange.find({ owner: req.user!.id })
    .sort({ createdAt: -1 })
    .limit(HISTORY_LIMIT)
    .lean();
  res.json({
    items: rows.map((r) => ({
      id: String(r._id),
      message: r.message,
      kind: r.kind,
      summary: r.summary,
      applied: r.applied ?? [],
      createdAt: (r.createdAt as Date).toISOString(),
    })),
  });
});

aiRouter.delete("/assistant/history", async (req, res) => {
  await AssistantExchange.deleteMany({ owner: req.user!.id });
  res.json({ ok: true });
});
