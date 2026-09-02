import { Router } from "express";
import { askSchema, semanticSearchSchema, type AiStatus } from "@loom/shared";
import type { z } from "zod";
import { getEmbeddingProvider } from "../ai/embeddings/provider";
import { semanticSearch } from "../ai/embeddings/semanticSearch";
import { getVectorStore } from "../ai/embeddings/vectorStore";
import { askCrm } from "../ai/features/nlQuery";
import { getGatewayStatus } from "../ai/gateway";
import { requireAuth } from "../middleware/auth";
import { aiLimiter } from "../middleware/rateLimit";
import { parsedQuery, validateBody, validateQuery } from "../middleware/validate";
import { getQueue } from "../jobs/queue";

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
