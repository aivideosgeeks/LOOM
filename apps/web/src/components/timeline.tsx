"use client";

import { useState } from "react";
import type { NoteDTO, NoteKind } from "@loom/shared";
import { Bot, FileText, Mail, Phone, ShieldAlert, Trash2, Users, Wrench } from "lucide-react";
import { toast } from "sonner";
import { SentimentBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errorMessage } from "@/lib/api";
import { useCreateNote, useDeleteNote } from "@/lib/hooks";
import { formatDate, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const KIND_META: Record<NoteKind, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  note: { label: "Note", icon: FileText },
  call: { label: "Call", icon: Phone },
  email: { label: "Email", icon: Mail },
  meeting: { label: "Meeting", icon: Users },
  system: { label: "System", icon: Wrench },
};

export function NoteComposer({ deal, contact }: { deal?: string; contact?: string }) {
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<NoteKind>("note");
  const create = useCreateNote();

  const submit = async () => {
    if (!content.trim()) return;
    try {
      await create.mutateAsync({ content: content.trim(), kind, deal, contact });
      setContent("");
      toast.success("Logged. Sentiment and lead score update in the background.");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-2 rounded-lg border bg-paper p-3">
      <Textarea
        placeholder="Log a note, call or email… (Ctrl+Enter to save)"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void submit();
        }}
        rows={3}
      />
      <div className="flex items-center justify-between gap-2">
        <Select value={kind} onValueChange={(v) => setKind(v as NoteKind)}>
          <SelectTrigger className="w-36" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["note", "call", "email", "meeting"] as NoteKind[]).map((k) => (
              <SelectItem key={k} value={k}>
                {KIND_META[k].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={submit} disabled={create.isPending || !content.trim()}>
          {create.isPending ? "Saving…" : "Add to timeline"}
        </Button>
      </div>
    </div>
  );
}

export function Timeline({ notes, emptyText = "No activity yet." }: { notes: NoteDTO[]; emptyText?: string }) {
  const del = useDeleteNote();
  if (!notes.length) return <p className="py-6 text-center text-sm text-ink-3">{emptyText}</p>;
  return (
    <ol className="relative space-y-4 border-l pl-5">
      {notes.map((n) => {
        const meta = KIND_META[n.kind] ?? KIND_META.note;
        const Icon = meta.icon;
        const system = n.kind === "system";
        return (
          <li key={n.id} className="relative">
            <span className={cn("absolute -left-[29px] flex size-6 items-center justify-center rounded-full border bg-background", system ? "text-ink-3" : "text-signal")}>
              <Icon className="size-3" />
            </span>
            <div className={cn("rounded-lg", system ? "" : "border bg-paper p-3")}>
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
                <span className="font-medium text-foreground">{meta.label}</span>
                {n.author && <span>· {n.author.name}</span>}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>· {timeAgo(n.createdAt)}</span>
                  </TooltipTrigger>
                  <TooltipContent>{formatDate(n.createdAt, "d MMM yyyy, HH:mm")}</TooltipContent>
                </Tooltip>
                {n.meeting && (
                  <span className="inline-flex items-center gap-1 text-signal">
                    <Bot className="size-3" /> AI summary
                  </span>
                )}
                {n.suspicious && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center gap-1 text-caution">
                        <ShieldAlert className="size-3" /> flagged
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">This note contains instruction-like text. It is treated as data and never as instructions by the AI features.</TooltipContent>
                  </Tooltip>
                )}
                <span className="ml-auto flex items-center gap-2">
                  <SentimentBadge sentiment={n.sentiment} />
                  {!system && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Delete note"
                      onClick={() => del.mutateAsync(n.id).then(() => toast.success("Note deleted")).catch((e) => toast.error(errorMessage(e)))}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  )}
                </span>
              </div>
              <p className={cn("mt-1 text-sm whitespace-pre-wrap", system && "text-ink-3")}>{n.content}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
