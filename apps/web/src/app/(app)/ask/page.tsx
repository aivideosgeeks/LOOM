"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { ContactDTO, DealDTO } from "@loom/shared";
import { Bot, MessageSquareText, SendHorizonal, ShieldCheck, Wand2 } from "lucide-react";
import { RiskBadge, ScoreBadge, StageBadge } from "@/components/badges";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage } from "@/lib/api";
import { useAsk, type AskResponse } from "@/lib/hooks";
import { formatDate, money, timeAgo } from "@/lib/format";

const EXAMPLES = [
  "Show me deals over $10k closing this month",
  "Which contacts haven't been touched in 30 days?",
  "My at-risk deals, biggest first",
  "Open deals in negotiation with a score above 70",
  "Contacts at Northwind tagged enterprise",
  "Delete all lost deals",
];

interface Exchange {
  question: string;
  answer: AskResponse | { ok: false; code: "error"; reason: string; details: string[] };
}

function ResultsTable({ answer }: { answer: AskResponse }) {
  if (!answer.rows?.length) return <p className="text-sm text-ink-3">No matching records.</p>;
  if (answer.entity === "deals") {
    const rows = answer.rows as DealDTO[];
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Deal</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead className="text-right">Score</TableHead>
            <TableHead>Close</TableHead>
            <TableHead>Last activity</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((d) => (
            <TableRow key={d.id}>
              <TableCell>
                <Link href={`/deals/${d.id}`} className="font-medium hover:underline">
                  {d.title}
                </Link>
                <p className="text-xs text-ink-3">{d.contact?.name}</p>
              </TableCell>
              <TableCell>
                <StageBadge stage={d.stage} />
              </TableCell>
              <TableCell className="text-right tabular">{money(d.value)}</TableCell>
              <TableCell className="text-right">
                <span className="inline-flex items-center gap-2">
                  <RiskBadge risk={d.risk} />
                  <ScoreBadge score={d.score} breakdown={d.scoreBreakdown} />
                </span>
              </TableCell>
              <TableCell className="text-sm text-ink-3">{formatDate(d.expectedCloseDate)}</TableCell>
              <TableCell className="text-sm text-ink-3">{timeAgo(d.lastActivityAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }
  const rows = answer.rows as ContactDTO[];
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Contact</TableHead>
          <TableHead>Company</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Tags</TableHead>
          <TableHead className="text-right">Score</TableHead>
          <TableHead>Last touch</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((c) => (
          <TableRow key={c.id}>
            <TableCell>
              <Link href={`/contacts/${c.id}`} className="font-medium hover:underline">
                {c.name}
              </Link>
            </TableCell>
            <TableCell className="text-sm">{c.company ?? "-"}</TableCell>
            <TableCell className="text-sm text-ink-3">{c.email ?? "-"}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {c.tags.map((t) => (
                  <Badge key={t} variant="outline">
                    {t}
                  </Badge>
                ))}
              </div>
            </TableCell>
            <TableCell className="text-right">
              <ScoreBadge score={c.score} />
            </TableCell>
            <TableCell className="text-sm text-ink-3">{timeAgo(c.lastActivityAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function AskPage() {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<Exchange[]>([]);
  const ask = useAsk();
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setQuestion("");
    try {
      const answer = await ask.mutateAsync(trimmed);
      setHistory((h) => [{ question: trimmed, answer }, ...h]);
    } catch (err) {
      setHistory((h) => [{ question: trimmed, answer: { ok: false, code: "error", reason: errorMessage(err), details: [] } }, ...h]);
    }
    inputRef.current?.focus();
  };

  return (
    <div className="enter-stack mx-auto max-w-5xl">
      <PageHeader
        title="Ask your CRM"
        description="Plain-English questions become validated, read-only queries. Claude proposes a typed filter; the server checks every field and operator against an allowlist before anything runs."
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(question);
        }}
        className="flex gap-2"
      >
        <Input ref={inputRef} autoFocus placeholder="e.g. which deals over $10k are closing this month?" value={question} onChange={(e) => setQuestion(e.target.value)} className="h-11 text-base" />
        <Button type="submit" size="lg" disabled={ask.isPending || !question.trim()} className="gap-2">
          <SendHorizonal className="size-4" /> {ask.isPending ? "Thinking…" : "Ask"}
        </Button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => void submit(ex)} className="rounded-full border px-3 py-1 text-xs text-ink-3 hover:bg-accent hover:text-foreground">
            {ex}
          </button>
        ))}
      </div>

      <div className="mt-8 space-y-6">
        {history.length === 0 && (
          <div className="flex flex-col items-center rounded-lg border border-dashed border-line p-10 text-center text-sm text-ink-3">
            <MessageSquareText className="mb-2 size-8" />
            Ask about deals or contacts. Results render as a real table you can click through.
          </div>
        )}
        {history.map((ex, i) => (
          <div key={i} className="space-y-3">
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-signal-foreground">{ex.question}</div>
            </div>
            <div className="rounded-2xl rounded-bl-sm border bg-paper p-4">
              {ex.answer.ok ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {ex.answer.translator === "ai" ? (
                      <Badge className="gap-1">
                        <Bot className="size-3" /> Claude
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1">
                        <Wand2 className="size-3" /> Rule-based (AI offline)
                      </Badge>
                    )}
                    <span>{ex.answer.explanation}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ShieldCheck className="size-3.5 text-good" />
                    <span className="text-xs text-ink-3">Validated query:</span>
                    <Badge variant="secondary">{ex.answer.entity}</Badge>
                    {ex.answer.filters?.map((f) => (
                      <Badge key={f} variant="outline" className="font-mono text-[11px]">
                        {f}
                      </Badge>
                    ))}
                    {ex.answer.scopedToOwn && <Badge variant="outline">scoped to your records</Badge>}
                    <span className="ml-auto text-xs text-ink-3">
                      {ex.answer.count} result{ex.answer.count === 1 ? "" : "s"}
                      {ex.answer.count === ex.answer.limit ? ` (limit ${ex.answer.limit})` : ""}
                    </span>
                  </div>
                  <ResultsTable answer={ex.answer} />
                </div>
              ) : (
                <div className="space-y-1 text-sm">
                  <p className="font-medium">
                    {ex.answer.code === "unsupported" ? "I can only answer read-only questions about deals and contacts." : ex.answer.code === "unavailable" ? "AI is unavailable right now." : "That query was rejected."}
                  </p>
                  <p className="text-ink-3">{ex.answer.reason}</p>
                  {ex.answer.details?.length ? (
                    <ul className="list-disc pl-5 text-xs text-ink-3">
                      {ex.answer.details.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
