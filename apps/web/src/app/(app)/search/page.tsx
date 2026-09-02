"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search as SearchIcon, Sparkles, TextSearch } from "lucide-react";
import { SentimentBadge } from "@/components/badges";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useSemanticSearch } from "@/lib/hooks";
import { timeAgo } from "@/lib/format";

const EXAMPLES = ["pricing pushback", "security review requirements", "champion with budget approved", "went quiet after the demo", "legal concerns about the contract"];

export default function SearchPage() {
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 350);
    return () => clearTimeout(t);
  }, [input]);
  const { data, isFetching } = useSemanticSearch(q);

  return (
    <div className="enter-stack mx-auto max-w-4xl">
      <PageHeader title="Semantic search" description="Search notes, calls, emails and meeting summaries by meaning. “pricing pushback” finds budget objections even when those words never appear. Falls back to keyword search if the vector store is unavailable." />
      <div className="relative">
        <SearchIcon className="absolute top-3 left-3 size-5 text-ink-3" />
        <Input autoFocus className="h-12 pl-10 text-base" placeholder="Describe what you are looking for…" value={input} onChange={(e) => setInput(e.target.value)} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => setInput(ex)} className="rounded-full border px-3 py-1 text-xs text-ink-3 hover:bg-accent hover:text-foreground">
            {ex}
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-3">
        {q && isFetching && !data && <Skeleton className="h-40" />}
        {data && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {data.mode === "semantic" ? (
              <Badge className="gap-1">
                <Sparkles className="size-3" /> Semantic match
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1">
                <TextSearch className="size-3" /> Keyword fallback
              </Badge>
            )}
            {data.degradedReason && <span className="text-xs text-ink-3">{data.degradedReason}</span>}
            <span className="ml-auto text-xs text-ink-3">
              {data.hits.length} result{data.hits.length === 1 ? "" : "s"}
            </span>
          </div>
        )}
        {data?.hits.length === 0 && <p className="text-sm text-ink-3">Nothing found. Try describing the situation differently.</p>}
        {data?.hits.map((h) => (
          <div key={h.note.id} className="rounded-lg border bg-paper p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
              <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-signal">{data.mode === "semantic" ? `${Math.round(h.score * 100)}% match` : `score ${h.score.toFixed(2)}`}</span>
              <span className="capitalize">{h.note.kind}</span>
              {h.deal && (
                <Link href={`/deals/${h.deal.id}`} className="font-medium text-foreground hover:underline">
                  {h.deal.title}
                </Link>
              )}
              {h.contact && (
                <Link href={`/contacts/${h.contact.id}`} className="hover:underline">
                  {h.contact.name}
                </Link>
              )}
              <span>· {timeAgo(h.note.createdAt)}</span>
              <span className="ml-auto">
                <SentimentBadge sentiment={h.note.sentiment} />
              </span>
            </div>
            <p className="mt-2 text-sm whitespace-pre-wrap">{h.note.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
