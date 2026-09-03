"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { AssistantReply, ContactDTO, DealDTO, NoteDTO, RecordRef, TaskDTO } from "@loom/shared";
import { ArrowUpRight, Bot, Check, History, Lightbulb, SendHorizonal, ShieldCheck, Trash2, Wand2 } from "lucide-react";
import { RiskBadge, ScoreBadge, StageBadge } from "@/components/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage } from "@/lib/api";
import { useAssistant, useAssistantHistory, useClearAssistantHistory, type AskResponse } from "@/lib/hooks";
import { formatDate, money, timeAgo } from "@/lib/format";

type Turn = { message: string; reply: AssistantReply | null; error?: string };

const HREF: Record<RecordRef["entity"], (id: string) => string> = {
  contact: (id) => `/contacts/${id}`,
  deal: (id) => `/deals/${id}`,
  task: () => "/tasks",
};

/** Suggestions that show what the assistant can actually do, not just ask. */
export const ASSISTANT_EXAMPLES = [
  "Add a contact: Priya Nair at Kestrel, priya@kestrel.io",
  "Remind me to call Marcus on Friday",
  "Tell me about the Globex deal",
  "Move the Umbrella deal to Negotiation",
  "Which deals are at risk?",
  "How do I invite someone to the team?",
];

function RecordLink({ record }: { record: RecordRef }) {
  return (
    <Link
      href={HREF[record.entity](record.id)}
      className="inline-flex items-center gap-1 rounded-md border border-line bg-background px-2 py-1 text-xs hover:bg-accent"
    >
      <span className="font-medium">{record.label}</span>
      {record.sublabel && <span className="text-ink-3">{record.sublabel}</span>}
      <ArrowUpRight className="size-3 text-ink-3" />
    </Link>
  );
}

function ResultsTable({ answer }: { answer: AskResponse }) {
  if (!answer.ok) return null;
  if (!answer.rows?.length) return <p className="text-sm text-ink-3">No matching records.</p>;
  if (answer.entity === "deals") {
    const rows = answer.rows as DealDTO[];
    return (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Deal</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead>Close</TableHead>
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }
  const rows = answer.rows as ContactDTO[];
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Contact</TableHead>
            <TableHead>Company</TableHead>
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
              <TableCell className="text-right">
                <ScoreBadge score={c.score} />
              </TableCell>
              <TableCell className="text-sm text-ink-3">{timeAgo(c.lastActivityAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** The card shown for "tell me about X": the record plus what is going on around it. */
function RecordCard({ record, detail }: { record: RecordRef; detail: unknown }) {
  const d = detail as {
    contact?: ContactDTO;
    deal?: DealDTO;
    deals?: DealDTO[];
    notes?: NoteDTO[];
    tasks?: TaskDTO[];
  };
  const subject = d.deal ?? d.contact;
  if (!subject) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={HREF[record.entity](record.id)} className="text-base font-medium hover:underline">
          {record.label}
        </Link>
        {d.deal && <StageBadge stage={d.deal.stage} />}
        {d.deal && <RiskBadge risk={d.deal.risk} />}
        <ScoreBadge score={subject.score} breakdown={d.deal?.scoreBreakdown} />
        {d.deal && <span className="text-sm tabular">{money(d.deal.value)}</span>}
        {d.contact?.company && <span className="text-sm text-ink-3">{d.contact.company}</span>}
      </div>

      {d.contact && (
        <div className="flex flex-wrap gap-3 text-sm text-ink-3">
          {d.contact.email && <span>{d.contact.email}</span>}
          {d.contact.phone && <span>{d.contact.phone}</span>}
        </div>
      )}

      {d.deals && d.deals.length > 0 && (
        <div>
          <p className="mb-1 text-xs uppercase tracking-wide text-ink-3">Deals</p>
          <div className="flex flex-wrap gap-1.5">
            {d.deals.map((deal) => (
              <RecordLink key={deal.id} record={{ entity: "deal", id: deal.id, label: deal.title, sublabel: deal.stage }} />
            ))}
          </div>
        </div>
      )}

      {d.tasks && d.tasks.length > 0 && (
        <div>
          <p className="mb-1 text-xs uppercase tracking-wide text-ink-3">Open tasks</p>
          <ul className="space-y-1 text-sm">
            {d.tasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3">
                <span>{t.title}</span>
                {t.dueDate && <span className="shrink-0 text-xs text-ink-3">{formatDate(t.dueDate)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {d.notes && d.notes.length > 0 && (
        <div>
          <p className="mb-1 text-xs uppercase tracking-wide text-ink-3">Recent notes</p>
          <ul className="space-y-1.5 text-sm text-ink-3">
            {d.notes.slice(0, 3).map((n) => (
              <li key={n.id} className="line-clamp-2">
                {n.content}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Reply({ turn }: { turn: Turn }) {
  if (turn.error) return <p className="text-sm text-ink-3">{turn.error}</p>;
  const reply = turn.reply;
  if (!reply) return null;

  if (reply.kind === "applied") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-good">
          <Check className="size-4" /> Done
        </div>
        <ul className="space-y-1 text-sm">
          {reply.applied.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        {reply.records.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {reply.records.map((r) => (
              <RecordLink key={`${r.entity}-${r.id}`} record={r} />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (reply.kind === "record") {
    return <RecordCard record={reply.record} detail={reply.detail} />;
  }

  if (reply.kind === "guide") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <Lightbulb className="size-4 text-signal" />
          <span>{reply.summary}</span>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-3">
          {reply.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </div>
    );
  }

  if (reply.kind === "answer") {
    const answer = reply.ask as AskResponse;
    if (!answer.ok) return <p className="text-sm text-ink-3">{answer.reason}</p>;
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {answer.translator === "ai" ? (
            <Badge className="gap-1">
              <Bot className="size-3" /> AI
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1">
              <Wand2 className="size-3" /> Rule-based
            </Badge>
          )}
          <span>{answer.explanation}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ShieldCheck className="size-3.5 text-good" />
          <Badge variant="secondary">{answer.entity}</Badge>
          {answer.filters?.map((f) => (
            <Badge key={f} variant="outline" className="font-mono text-[11px]">
              {f}
            </Badge>
          ))}
          <span className="ml-auto text-xs text-ink-3">
            {answer.count} result{answer.count === 1 ? "" : "s"}
          </span>
        </div>
        <ResultsTable answer={answer} />
      </div>
    );
  }

  return (
    <div className="space-y-1 text-sm">
      <p className="text-ink-3">{reply.reason}</p>
      {reply.details?.length ? (
        <ul className="list-disc pl-5 text-xs text-ink-3">
          {reply.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The conversation itself, used both on the Ask page and inside the floating
 * panel so there is one implementation to reason about.
 */
export function AssistantThread({ compact = false }: { compact?: boolean }) {
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const assistant = useAssistant();
  const history = useAssistantHistory();
  const clearHistory = useClearAssistantHistory();
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setMessage("");
    try {
      const reply = await assistant.mutateAsync(trimmed);
      setTurns((t) => [{ message: trimmed, reply }, ...t]);
    } catch (err) {
      setTurns((t) => [{ message: trimmed, reply: null, error: errorMessage(err) }, ...t]);
    }
    inputRef.current?.focus();
  };

  const past = history.data?.items ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(message);
        }}
        className="flex gap-2"
      >
        <Input
          ref={inputRef}
          autoFocus={!compact}
          placeholder="Ask, or tell me what to do…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className={compact ? "" : "h-11 text-base"}
        />
        <Button type="submit" size={compact ? "default" : "lg"} disabled={assistant.isPending || !message.trim()} className="gap-2">
          <SendHorizonal className="size-4" />
          {assistant.isPending ? "Working…" : "Send"}
        </Button>
      </form>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {ASSISTANT_EXAMPLES.slice(0, compact ? 4 : 6).map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => void submit(ex)}
            className="rounded-full border px-2.5 py-1 text-xs text-ink-3 hover:bg-accent hover:text-foreground"
          >
            {ex}
          </button>
        ))}
      </div>

      <div className={`quiet-scroll mt-6 min-h-0 flex-1 space-y-5 ${compact ? "overflow-y-auto pr-1" : ""}`}>
        {turns.length === 0 && (
          <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-ink-3">
            Ask about your pipeline, add a contact or task, open a record, or ask how something works.
          </p>
        )}

        {turns.map((turn, i) => (
          <div key={i} className="space-y-2">
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-signal-foreground">
                {turn.message}
              </div>
            </div>
            <div className="rounded-2xl rounded-bl-sm border bg-paper p-3.5">
              <Reply turn={turn} />
            </div>
          </div>
        ))}

        {past.length > 0 && (
          <section className="border-t border-line pt-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-3">
                <History className="size-3.5" /> Earlier
              </h2>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void clearHistory.mutateAsync()}
                disabled={clearHistory.isPending}
                className="h-7 gap-1.5 text-xs text-ink-3"
              >
                <Trash2 className="size-3" /> Clear
              </Button>
            </div>
            <ul className="space-y-1">
              {past.slice(0, compact ? 8 : 25).map((h) => (
                <li key={h.id} className="flex items-baseline gap-2 text-sm">
                  <button type="button" onClick={() => void submit(h.message)} className="truncate text-left hover:underline">
                    {h.message}
                  </button>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {h.kind}
                  </Badge>
                  <span className="ml-auto shrink-0 text-xs text-ink-3">{timeAgo(h.createdAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
