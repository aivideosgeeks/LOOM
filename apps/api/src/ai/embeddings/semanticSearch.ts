import type { SemanticSearchHit, SemanticSearchResponse } from "@loom/shared";
import { logger } from "../../lib/logger";
import type { AuthUser } from "../../middleware/auth";
import { Contact, Deal, Note } from "../../models";
import { toNoteDTO } from "../../services/serializers";
import { sanitizeText } from "../sanitize";
import { getEmbeddingProvider } from "./provider";
import { getVectorStore } from "./vectorStore";

/** Embed a single note into the vector store. Called from the note.enrich job. */
export async function embedNote(noteId: string): Promise<void> {
  const note = await Note.findById(noteId);
  if (!note) return;
  if (note.kind === "system" || note.content.trim().length < 3) {
    note.embeddingStatus = "skipped";
    await note.save();
    return;
  }
  const provider = getEmbeddingProvider();
  if (!(await provider.ready())) {
    note.embeddingStatus = "failed";
    await note.save();
    return;
  }
  try {
    const [vector] = await provider.embed([sanitizeText(note.content, 8000)], "document");
    await getVectorStore().upsert(provider.model, [
      { id: String(note._id), vector, metadata: { owner: String(note.owner), deal: note.deal ? String(note.deal) : null, contact: note.contact ? String(note.contact) : null } },
    ]);
    note.embeddingStatus = "done";
  } catch (err) {
    logger.warn({ err, noteId }, "Embedding failed");
    note.embeddingStatus = "failed";
  }
  await note.save();
}

export async function removeNoteEmbedding(noteId: string): Promise<void> {
  try {
    await getVectorStore().remove(getEmbeddingProvider().model, [noteId]);
  } catch (err) {
    logger.warn({ err, noteId }, "Failed to remove note embedding");
  }
}

async function hydrate(noteIds: string[], scores: Map<string, number>, user: AuthUser): Promise<SemanticSearchHit[]> {
  const filter: Record<string, unknown> = { _id: { $in: noteIds } };
  if (user.role !== "admin") filter.owner = user.id;
  const notes = await Note.find(filter).populate("author", "name email role").lean();
  const dealIds = [...new Set(notes.filter((n) => n.deal).map((n) => String(n.deal)))];
  const contactIds = [...new Set(notes.filter((n) => n.contact).map((n) => String(n.contact)))];
  const [deals, contacts] = await Promise.all([
    Deal.find({ _id: { $in: dealIds } }).select("title").lean(),
    Contact.find({ _id: { $in: contactIds } }).select("name").lean(),
  ]);
  const dealMap = new Map(deals.map((d) => [String(d._id), d.title]));
  const contactMap = new Map(contacts.map((c) => [String(c._id), c.name]));
  return notes
    .map((n) => ({
      note: toNoteDTO(n),
      score: scores.get(String(n._id)) ?? 0,
      deal: n.deal ? { id: String(n.deal), title: dealMap.get(String(n.deal)) ?? "" } : null,
      contact: n.contact ? { id: String(n.contact), name: contactMap.get(String(n.contact)) ?? "" } : null,
    }))
    .sort((a, b) => b.score - a.score);
}

async function textSearch(q: string, user: AuthUser, limit: number): Promise<SemanticSearchHit[]> {
  const filter: Record<string, unknown> = { $text: { $search: q }, kind: { $ne: "system" } };
  if (user.role !== "admin") filter.owner = user.id;
  const notes = await Note.find(filter, { score: { $meta: "textScore" } })
    .sort({ score: { $meta: "textScore" } })
    .limit(limit)
    .lean();
  const scores = new Map(notes.map((n) => [String(n._id), Number((n as { score?: number }).score ?? 0)]));
  return hydrate(
    notes.map((n) => String(n._id)),
    scores,
    user,
  );
}

/**
 * Meaning-based search over notes. Falls back to MongoDB text search when the embedding
 * provider or vector store is unavailable, or when nothing has been embedded yet.
 */
export async function semanticSearch(q: string, user: AuthUser, limit = 10): Promise<SemanticSearchResponse> {
  const query = sanitizeText(q, 300);
  const provider = getEmbeddingProvider();
  const store = getVectorStore();
  let degradedReason: string | null = null;

  try {
    if (!(await provider.ready())) {
      degradedReason = "Embedding model not available";
    } else if (!(await store.healthy())) {
      degradedReason = `Vector store (${store.name}) unreachable`;
    } else {
      const [vector] = await provider.embed([query], "query");
      const matches = await store.query(provider.model, vector, limit * 2, user.role === "admin" ? {} : { owner: user.id });
      const relevant = matches.filter((m) => m.score > 0.2);
      if (relevant.length) {
        const scores = new Map(relevant.map((m) => [m.id, Math.round(m.score * 1000) / 1000]));
        const hits = (await hydrate(relevant.map((m) => m.id), scores, user)).slice(0, limit);
        if (hits.length) return { mode: "semantic", degradedReason: null, hits };
      }
      degradedReason = matches.length ? "No semantically similar notes" : "No notes embedded yet";
    }
  } catch (err) {
    logger.warn({ err }, "Semantic search failed; falling back to text search");
    degradedReason = `Semantic search error: ${err instanceof Error ? err.message : String(err)}`;
  }

  const hits = await textSearch(query, user, limit);
  return { mode: "text", degradedReason, hits };
}
