"use client";

import { useState } from "react";
import Link from "next/link";
import type { Stage } from "@loom/shared";
import { PIPELINE_STAGES } from "@loom/shared";
import { ArrowDown, ArrowUp, ArrowUpDown, Handshake, Search } from "lucide-react";
import { RiskBadge, ScoreBadge, StageBadge } from "@/components/badges";
import { EmptyState, PageHeader } from "@/components/page-header";
import { DealDialog } from "@/components/record-dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDeals } from "@/lib/hooks";
import { formatDate, money, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

type SortKey = "score" | "value" | "title" | "stage" | "lastActivityAt" | "expectedCloseDate";

export default function DealsPage() {
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<Stage | "all">("all");
  const [atRisk, setAtRisk] = useState<"all" | "true">("all");
  const [sort, setSort] = useState<SortKey>("score");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const limit = 25;
  const { data, isLoading } = useDeals({ q, stage: stage === "all" ? "" : stage, atRisk: atRisk === "all" ? "" : atRisk, sort, dir, page, limit });

  const toggleSort = (key: SortKey) => {
    if (sort === key) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setSort(key);
      setDir(key === "title" || key === "stage" ? "asc" : "desc");
    }
    setPage(1);
  };

  const SortHead = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <TableHead className={className}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(k)}>
        {children}
        {sort === k ? dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
      </button>
    </TableHead>
  );

  const pages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;

  return (
    <div className="enter-stack">
      <PageHeader title="Deals" description="Every deal carries an AI lead score (0-100) that recalculates in the background whenever the deal or its notes change." actions={<DealDialog />} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute top-2.5 left-2.5 size-4 text-ink-3" />
          <Input
            placeholder="Search deals or contacts…"
            className="w-64 pl-8"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select
          value={stage}
          onValueChange={(v) => {
            setStage(v as Stage | "all");
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {PIPELINE_STAGES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant={atRisk === "true" ? "destructive" : "outline"} size="sm" onClick={() => setAtRisk(atRisk === "true" ? "all" : "true")}>
          At risk only
        </Button>
        {data && (
          <span className="ml-auto text-sm text-ink-3">
            {data.total} deal{data.total === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {isLoading && !data ? (
        <Skeleton className="h-96" />
      ) : data && data.items.length === 0 ? (
        <EmptyState icon={Handshake} title="No deals match" description="Try a different filter or create a deal." action={<DealDialog />} />
      ) : (
        <div className="rounded-lg border bg-paper">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead k="title">Deal</SortHead>
                <SortHead k="stage">Stage</SortHead>
                <SortHead k="value" className="text-right">
                  Value
                </SortHead>
                <SortHead k="score" className="text-right">
                  Score
                </SortHead>
                <TableHead>Risk</TableHead>
                <SortHead k="lastActivityAt">Last activity</SortHead>
                <SortHead k="expectedCloseDate">Close date</SortHead>
                <TableHead>Owner</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.map((d) => (
                <TableRow key={d.id} className={cn(d.risk?.atRisk && "bg-bad-wash/30")}>
                  <TableCell>
                    <Link href={`/deals/${d.id}`} className="font-medium hover:underline">
                      {d.title}
                    </Link>
                    <p className="text-xs text-ink-3">
                      {d.contact?.name}
                      {d.contact?.company ? ` · ${d.contact.company}` : ""}
                    </p>
                  </TableCell>
                  <TableCell>
                    <StageBadge stage={d.stage} />
                  </TableCell>
                  <TableCell className="text-right tabular">{money(d.value)}</TableCell>
                  <TableCell className="text-right">
                    <ScoreBadge score={d.score} breakdown={d.scoreBreakdown} />
                  </TableCell>
                  <TableCell>
                    <RiskBadge risk={d.risk} />
                  </TableCell>
                  <TableCell className="text-sm text-ink-3">{timeAgo(d.lastActivityAt)}</TableCell>
                  <TableCell className="text-sm text-ink-3">{formatDate(d.expectedCloseDate)}</TableCell>
                  <TableCell className="text-sm text-ink-3">{d.owner?.name ?? "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 border-t p-2 text-sm">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="text-ink-3">
                Page {page} of {pages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
