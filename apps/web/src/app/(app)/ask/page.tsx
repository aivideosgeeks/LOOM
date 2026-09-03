"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { AssistantReply, AssistantStep, ContactDTO, DealDTO } from "@loom/shared";
import { Bot, Check, History, MessageSquareText, SendHorizonal, ShieldCheck, Trash2, Wand2, X } from "lucide-react";
import { RiskBadge, ScoreBadge, StageBadge } from "@/components/badges";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage } from "@/lib/api";
import {
  useAssistant,
  useAssistantExecute,
  useAssistantHistory,
  useClearAssistantHistory,
  type AskResponse,
} from "@/lib/hooks";
import { formatDate, money, timeAgo } from "@/lib/format";

const EXAMPLES = [
  "Show me deals over $10k closing this month",
  "Which contacts haven't been touched in 30 days?",
  "Remind me to call Sarah on Friday",
  "Move the Globex deal to Proposal",
  "Add a note to Northwind: they asked about pricing",
  "Delete all lost deals",
];

type Turn = { message: string; reply: AssistantReply | null; error?: string; applied?: string[] };

function ResultsTable({ answer }: { answer: AskResponse }) {
  if (!answer.ok) return null;
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

/**
 * A proposal is shown as a list of the exact changes, with Apply and Discard.
 * Nothing has happened at this point; the assistant only ever proposes.
 */
function Proposal({
  steps,
  onApply,
  onDiscard,
  pending,
  applied,
}: {
  steps: AssistantStep[];
  onApply: () => void;
  onDiscard: () => void;
  pending: boolean;
  applied?: string[];
}) {
  if (applied) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-good">
          <Check className="size-4" /> Applied
        </div>
        <ul className="space-y-1 text-sm text-ink-3">
          {applied.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-3">Nothing has changed yet. Review and confirm:</p>
      <ul className="space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2 rounded-md border border-line bg-background p-3 text-sm">
            <Wand2 className="mt-0.5 size-3.5 shrink-0 text-signal" />
            <span>{s.description}</span>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button size="sm" onClick={onApply} disabled={pending} className="gap-1.5">
          <Check className="size-3.5" /> {pending ? "Applying…" : `Apply ${steps.length === 1 ? "change" : `all ${steps.length}`}`}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDiscard} disabled={pending} className="gap-1.5">
          <X className="size-3.5" /> Discard
        </Button>
      </div>
    </div>
  );
}

export default function AskPage() {
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const assistant = useAssistant();
  const execute = useAssistantExecute();
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

  const apply = async (index: number, steps: AssistantStep[]) => {
    try {
      const result = await execute.mutateAsync(steps.map((s) => s.action));
      setTurns((t) => t.map((turn, i) => (i === index ? { ...turn, applied: result.applied } : turn)));
    } catch (err) {
      setTurns((t) => t.map((turn, i) => (i === index ? { ...turn, error: errorMessage(err) } : turn)));
    }
  };

  const discard = (index: number) => {
    setTurns((t) => t.map((turn, i) => (i === index ? { ...turn, reply: null, error: "Discarded." } : turn)));
  };

  const past = history.data?.items ?? [];

  return (
    <div className="enter-stack mx-auto max-w-5xl">
      <PageHeader
        title="Ask your CRM"
        description="Ask a question or ask for a change. Questions become validated read-only queries. Changes are proposed as a list you confirm — the assistant never edits anything on its own."
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(message);
        }}
        className="flex gap-2"
      >
        <Input
          ref={inputRef}
          autoFocus
          placeholder="e.g. remind me to call Sarah on Friday"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="h-11 text-base"
        />
        <Button type="submit" size="lg" disabled={assistant.isPending || !message.trim()} className="gap-2">
          <SendHorizonal className="size-4" /> {assistant.isPending ? "Thinking…" : "Send"}
        </Button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => void submit(ex)}
            className="rounded-full border px-3 py-1 text-xs text-ink-3 hover:bg-accent hover:text-foreground"
          >
            {ex}
          </button>
        ))}
      </div>

      <div className="mt-8 space-y-6">
        {turns.length === 0 && (
          <div className="flex flex-col items-center rounded-lg border border-dashed border-line p-10 text-center text-sm text-ink-3">
            <MessageSquareText className="mb-2 size-8" />
            Ask about deals and contacts, or ask for a task, a note or a stage change.
          </div>
        )}

        {turns.map((turn, i) => (
          <div key={i} className="space-y-3">
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-signal-foreground">
                {turn.message}
              </div>
            </div>
            <div className="rounded-2xl rounded-bl-sm border bg-paper p-4">
              {turn.error && !turn.applied ? (
                <p className="text-sm text-ink-3">{turn.error}</p>
              ) : turn.applied ? (
                <Proposal steps={[]} onApply={() => {}} onDiscard={() => {}} pending={false} applied={turn.applied} />
              ) : turn.reply?.kind === "proposal" ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Badge className="gap-1">
                      <Bot className="size-3" /> Proposed
                    </Badge>
                    <span>{turn.reply.summary}</span>
                  </div>
                  <Proposal
                    steps={turn.reply.steps}
                    onApply={() => void apply(i, (turn.reply as { steps: AssistantStep[] }).steps)}
                    onDiscard={() => discard(i)}
                    pending={execute.isPending}
                  />
                </div>
              ) : turn.reply?.kind === "answer" ? (
                <AnswerCard answer={turn.reply.ask as AskResponse} />
              ) : turn.reply?.kind === "refused" ? (
                <div className="space-y-1 text-sm">
                  <p className="font-medium">I could not do that.</p>
                  <p className="text-ink-3">{turn.reply.reason}</p>
                  {turn.reply.details?.length ? (
                    <ul className="list-disc pl-5 text-xs text-ink-3">
                      {turn.reply.details.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {past.length > 0 && (
        <section className="mt-12 border-t border-line pt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <History className="size-4 text-ink-3" /> Earlier
            </h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void clearHistory.mutateAsync()}
              disabled={clearHistory.isPending}
              className="gap-1.5 text-ink-3"
            >
              <Trash2 className="size-3.5" /> Clear
            </Button>
          </div>
          <ul className="space-y-1.5">
            {past.map((h) => (
              <li key={h.id} className="flex items-baseline gap-3 text-sm">
                <button
                  type="button"
                  onClick={() => void submit(h.message)}
                  className="truncate text-left hover:underline"
                  title="Ask again"
                >
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
  );
}

function AnswerCard({ answer }: { answer: AskResponse }) {
  if (!answer.ok) {
    return (
      <div className="space-y-1 text-sm">
        <p className="font-medium">That query was rejected.</p>
        <p className="text-ink-3">{answer.reason}</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {answer.translator === "ai" ? (
          <Badge className="gap-1">
            <Bot className="size-3" /> AI
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1">
            <Wand2 className="size-3" /> Rule-based (AI offline)
          </Badge>
        )}
        <span>{answer.explanation}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <ShieldCheck className="size-3.5 text-good" />
        <span className="text-xs text-ink-3">Validated query:</span>
        <Badge variant="secondary">{answer.entity}</Badge>
        {answer.filters?.map((f) => (
          <Badge key={f} variant="outline" className="font-mono text-[11px]">
            {f}
          </Badge>
        ))}
        {answer.scopedToOwn && <Badge variant="outline">scoped to your records</Badge>}
        <span className="ml-auto text-xs text-ink-3">
          {answer.count} result{answer.count === 1 ? "" : "s"}
          {answer.count === answer.limit ? ` (limit ${answer.limit})` : ""}
        </span>
      </div>
      <ResultsTable answer={answer} />
    </div>
  );
}
