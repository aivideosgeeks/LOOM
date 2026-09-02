"use client";

import { useState } from "react";
import { Activity, Coins, Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api";
import { useAiUsage, useRunJob } from "@/lib/hooks";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const FEATURE_LABELS: Record<string, string> = {
  lead_scoring: "Lead scoring",
  sentiment: "Note sentiment",
  email_draft: "Email drafting",
  nl_query: "Ask your CRM",
  meeting_summary: "Meeting summaries",
  semantic_search: "Embeddings / search",
  duplicate_detection: "Duplicate detection",
  risk_flagging: "Risk flagging",
};

const usd = (n: number) => `$${n.toFixed(4)}`;
const num = (n: number) => n.toLocaleString();

export default function AiUsagePage() {
  const [days, setDays] = useState(30);
  const { data, isLoading, refetch } = useAiUsage(days);
  const runJob = useRunJob();

  const resetCircuit = async () => {
    try {
      await api("/api/admin/ai/reset-circuit", { method: "POST" });
      toast.success("Circuit breaker reset");
      void refetch();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI usage & cost"
        description="Every LLM call is logged with tokens, latency, cache hits and an estimated cost, so spend is auditable per feature."
        actions={
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 7, 30, 90].map((d) => (
                <SelectItem key={d} value={String(d)}>
                  Last {d} day{d === 1 ? "" : "s"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {isLoading || !data ? (
        <Skeleton className="h-80" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="py-4">
              <CardContent>
                <p className="text-xs text-ink-3">Provider</p>
                <p className="font-medium">
                  {data.status.configured ? `${data.status.provider} · ${data.status.model}` : "Not configured (fallback mode)"}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant={data.status.circuit === "closed" ? "secondary" : "destructive"}>circuit {data.status.circuit}</Badge>
                  {data.status.consecutiveFailures > 0 && <span className="text-xs text-ink-3">{data.status.consecutiveFailures} consecutive failures</span>}
                  {data.status.circuit !== "closed" && (
                    <Button size="xs" variant="outline" onClick={resetCircuit}>
                      <RotateCcw className="size-3" /> Reset
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
            <Card className="py-4">
              <CardContent>
                <p className="flex items-center gap-1 text-xs text-ink-3">
                  <Coins className="size-3" /> Estimated spend
                </p>
                <p className="text-2xl font-semibold tabular">{usd(data.totalCostUsd)}</p>
                <p className="text-xs text-ink-3">{num(data.rows.reduce((a, r) => a + r.calls, 0))} calls logged</p>
              </CardContent>
            </Card>
            <Card className="py-4">
              <CardContent>
                <p className="flex items-center gap-1 text-xs text-ink-3">
                  <Play className="size-3" /> Background jobs
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(["risk-scan", "rescore", "dedupe-scan"] as const).map((j) => (
                    <Button key={j} size="xs" variant="outline" disabled={runJob.isPending} onClick={() => runJob.mutateAsync(j).then(() => toast.success(`${j} queued`)).catch((e) => toast.error(errorMessage(e)))}>
                      {j}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>By feature</CardTitle>
              <CardDescription>Cached = served from the response cache (no tokens billed). Fallback calls are logged when no provider is configured.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Feature</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Cached</TableHead>
                    <TableHead className="text-right">Errors</TableHead>
                    <TableHead className="text-right">Input tok</TableHead>
                    <TableHead className="text-right">Output tok</TableHead>
                    <TableHead className="text-right">Cache read</TableHead>
                    <TableHead className="text-right">Avg latency</TableHead>
                    <TableHead className="text-right">Est. cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((r) => (
                    <TableRow key={r.feature}>
                      <TableCell className="font-medium">{FEATURE_LABELS[r.feature] ?? r.feature}</TableCell>
                      <TableCell className="text-right tabular">{num(r.calls)}</TableCell>
                      <TableCell className="text-right tabular">{num(r.cached)}</TableCell>
                      <TableCell className={cn("text-right tabular", r.errors && "text-bad")}>{num(r.errors)}</TableCell>
                      <TableCell className="text-right tabular">{num(r.inputTokens)}</TableCell>
                      <TableCell className="text-right tabular">{num(r.outputTokens)}</TableCell>
                      <TableCell className="text-right tabular">{num(r.cacheReadTokens)}</TableCell>
                      <TableCell className="text-right tabular">{r.avgLatencyMs ? `${num(r.avgLatencyMs)} ms` : "-"}</TableCell>
                      <TableCell className="text-right tabular">{usd(r.estCostUsd)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="size-4" /> Recent calls
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Feature</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">Tokens in/out</TableHead>
                    <TableHead className="text-right">Latency</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recent.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs whitespace-nowrap text-ink-3">{formatDate(r.createdAt, "d MMM HH:mm:ss")}</TableCell>
                      <TableCell className="text-sm">{FEATURE_LABELS[r.feature] ?? r.feature}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === "ok" ? "secondary" : r.status === "cached" ? "outline" : r.status === "fallback" ? "outline" : "destructive"}>{r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">{r.model}</TableCell>
                      <TableCell className="text-right text-xs tabular">
                        {num(r.inputTokens)} / {num(r.outputTokens)}
                        {r.cacheReadTokens ? ` (+${num(r.cacheReadTokens)} cached)` : ""}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular">{r.latencyMs} ms</TableCell>
                      <TableCell className="text-right text-xs tabular">{usd(r.estCostUsd)}</TableCell>
                      <TableCell className="max-w-xs truncate text-xs text-ink-3">{r.error ?? ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
