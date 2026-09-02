"use client";

import Link from "next/link";
import type { ContactDTO } from "@loom/shared";
import { Bot, Copy, GitMerge, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { useDismissDuplicate, useDuplicates, useMergeDuplicate, useScanDuplicates } from "@/lib/hooks";
import { formatDate, timeAgo } from "@/lib/format";

function ContactCard({ c, label, onKeep, busy }: { c: ContactDTO; label: string; onKeep: () => void; busy: boolean }) {
  return (
    <div className="flex-1 space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-ink-3 uppercase">{label}</span>
        <Button size="sm" variant="outline" className="gap-1" onClick={onKeep} disabled={busy}>
          <GitMerge className="size-3.5" /> Keep this one
        </Button>
      </div>
      <Link href={`/contacts/${c.id}`} className="block font-medium hover:underline">
        {c.name}
      </Link>
      <dl className="grid grid-cols-[80px_1fr] gap-y-0.5 text-sm">
        <dt className="text-ink-3">Email</dt>
        <dd className="truncate">{c.email ?? "-"}</dd>
        <dt className="text-ink-3">Phone</dt>
        <dd>{c.phone ?? "-"}</dd>
        <dt className="text-ink-3">Company</dt>
        <dd>{c.company ?? "-"}</dd>
        <dt className="text-ink-3">Owner</dt>
        <dd>{c.owner?.name ?? "-"}</dd>
        <dt className="text-ink-3">Created</dt>
        <dd>
          {formatDate(c.createdAt)} · touched {timeAgo(c.lastActivityAt)}
        </dd>
      </dl>
      {c.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {c.tags.map((t) => (
            <Badge key={t} variant="outline">
              {t}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DuplicatesPage() {
  const { data, isLoading } = useDuplicates("pending");
  const merge = useMergeDuplicate();
  const dismiss = useDismissDuplicate();
  const scan = useScanDuplicates();
  const busy = merge.isPending || dismiss.isPending;

  const doMerge = async (id: string, survivorId: string, loserName: string) => {
    if (!window.confirm(`Merge "${loserName}" into the kept contact? Deals, notes and tasks move over; the other record is retired.`)) return;
    try {
      await merge.mutateAsync({ id, survivorId });
      toast.success("Merged");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="enter-stack mx-auto max-w-5xl">
      <PageHeader
        title="Possible duplicates"
        description="Fuzzy matching on emails, names (nicknames, order, typos), phones and companies, with an optional verdict from Claude. Nothing is merged without your approval."
        actions={
          <Button variant="outline" size="sm" className="gap-2" onClick={() => scan.mutateAsync().then(() => toast.success("Full scan queued")).catch((e) => toast.error(errorMessage(e)))} disabled={scan.isPending}>
            <RefreshCw className="size-4" /> Scan all contacts
          </Button>
        }
      />
      {isLoading && <Skeleton className="h-64" />}
      {data && data.candidates.length === 0 && <EmptyState icon={Copy} title="No duplicates waiting" description="New and edited contacts are checked automatically; a full scan runs nightly." />}
      <div className="space-y-4">
        {data?.candidates.map((cand) => (
          <Card key={cand.id}>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={cand.score >= 0.85 ? "destructive" : "secondary"}>{Math.round(cand.score * 100)}% match</Badge>
                {cand.reasons.map((r) => (
                  <span key={r} className="text-xs text-ink-3">
                    • {r}
                  </span>
                ))}
              </div>
              {cand.aiVerdict && (
                <p className="flex items-start gap-2 rounded-md bg-primary/5 p-2 text-sm">
                  <Bot className="mt-0.5 size-4 shrink-0 text-signal" />
                  <span>
                    <span className="font-medium">Claude: {cand.aiVerdict.isDuplicate ? "likely the same person" : "probably different people"}</span> ({Math.round(cand.aiVerdict.confidence * 100)}% confident). {cand.aiVerdict.reason}
                  </span>
                </p>
              )}
              <div className="flex flex-col gap-3 md:flex-row">
                <ContactCard c={cand.a} label="Record A" busy={busy} onKeep={() => void doMerge(cand.id, cand.a.id, cand.b.name)} />
                <ContactCard c={cand.b} label="Record B" busy={busy} onKeep={() => void doMerge(cand.id, cand.b.id, cand.a.name)} />
              </div>
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" className="gap-1" disabled={busy} onClick={() => dismiss.mutateAsync(cand.id).then(() => toast.success("Dismissed")).catch((e) => toast.error(errorMessage(e)))}>
                  <X className="size-4" /> Not a duplicate
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
