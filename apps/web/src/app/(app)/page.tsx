"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, Bot, CheckCircle2, CheckSquare, Contact, Handshake, Trophy } from "lucide-react";
import { RiskBadge, ScoreBadge, StageBadge } from "@/components/badges";
import { TaskRow } from "@/components/tasks-panel";
import { Timeline } from "@/components/timeline";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDashboard, useMe } from "@/lib/hooks";
import { compactMoney, money, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

function Figure({ label, value, icon: Icon, tone }: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; tone?: "good" | "bad" }) {
  return (
    <div className="flex items-center gap-3 px-4 py-4 md:px-5">
      <Icon className={cn("size-4 shrink-0", tone === "bad" ? "text-bad" : tone === "good" ? "text-good" : "text-ink-3")} />
      <div className="min-w-0">
        <p className="font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase">{label}</p>
        <p className={cn("font-display truncate text-2xl leading-tight tabular", tone === "bad" && "text-bad", tone === "good" && "text-good")}>{value}</p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { data: me } = useMe();
  const { data, isLoading } = useDashboard();

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24" />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Skeleton className="h-96" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }

  // Bars are sized by value, not deal count: counts are often equal across stages
  // and would draw six identical bars that say nothing.
  const maxValue = Math.max(1, ...data.pipeline.map((p) => p.value));
  const firstName = me?.user.name.split(" ")[0] ?? "";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="enter-stack flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="font-mono text-[10px] tracking-[0.14em] text-ink-3 uppercase">
          {me?.user.role === "admin" ? "Whole-team pipeline" : "Your pipeline"}
        </p>
        <h1 className="font-display text-3xl md:text-4xl">
          {greeting}, {firstName}
        </h1>
      </header>

      {/* One connected panel rather than five floating cards: the figures read as a set. */}
      <div className="grid grid-cols-2 divide-line overflow-hidden rounded-xl border border-line bg-paper shadow-[var(--lift)] sm:divide-x lg:grid-cols-5 [&>*]:border-line [&>*:nth-child(n+3)]:border-t sm:[&>*:nth-child(n+3)]:border-t-0 [&>*:nth-child(even)]:border-l lg:[&>*]:border-t-0 lg:[&>*:nth-child(even)]:border-l-0">
        <Figure label="Open pipeline" value={compactMoney(data.totals.openValue)} icon={Handshake} />
        <Figure label="Open deals" value={String(data.totals.openDeals)} icon={CheckCircle2} />
        <Figure label="At risk" value={String(data.totals.atRisk)} icon={AlertTriangle} tone={data.totals.atRisk > 0 ? "bad" : undefined} />
        <Figure label="Contacts" value={String(data.totals.contacts)} icon={Contact} />
        <Figure label="Won all time" value={compactMoney(data.totals.wonValue)} icon={Trophy} tone="good" />
      </div>

      {/*
        Two independent column stacks, so a card that shrinks (a task ticked off,
        a risk cleared) lets the cards below it move up instead of leaving the hole
        that equal-height grid rows would. The rail sticks as the main column
        scrolls past it, so the shorter side never reads as dead space.
      */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-bad" /> Deals at risk
              </CardTitle>
              <CardDescription>
                Flagged on every deal change and by the daily scan: a stalled stage, no activity, sentiment turning negative, or a close date that no longer looks real.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {data.atRiskDeals.length === 0 ? (
                <div className="flex items-center gap-3 rounded-lg border border-dashed border-line px-4 py-6 text-sm text-ink-2">
                  <CheckCircle2 className="size-4 text-good" />
                  Nothing at risk. Every open deal is moving.
                </div>
              ) : (
                data.atRiskDeals.map((d) => (
                  <Link
                    key={d.id}
                    href={`/deals/${d.id}`}
                    className="lift block rounded-lg border border-line bg-paper p-3.5 focus-visible:outline-none"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{d.title}</span>
                      <span className="flex items-center gap-2.5">
                        <StageBadge stage={d.stage} />
                        <span className="text-sm tabular text-ink-2">{money(d.value)}</span>
                        <ScoreBadge score={d.score} breakdown={d.scoreBreakdown} />
                      </span>
                    </div>
                    <p className="mt-2 flex gap-1.5 text-sm text-ink-2">
                      {d.risk?.reasonSource === "ai" && <Bot className="mt-0.5 size-3.5 shrink-0 text-signal" />}
                      <span>{d.risk?.aiReason}</span>
                    </p>
                    {d.risk?.suggestedAction && (
                      <p className="mt-1.5 text-sm">
                        <span className="font-mono text-[10px] tracking-[0.1em] text-ink-3 uppercase">Next</span>{" "}
                        <span className="text-ink-2">{d.risk.suggestedAction}</span>
                      </p>
                    )}
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {d.risk?.signals.map((s) => (
                        <span key={s} className="rounded bg-bad-wash px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-bad">
                          {s.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Strongest open deals</CardTitle>
              <CardDescription>Ranked by lead score. Hover a gauge for the full breakdown.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Deal</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.topDeals.map((d) => (
                      <TableRow key={d.id} className="row-hover">
                        <TableCell>
                          <Link href={`/deals/${d.id}`} className="font-medium transition-colors hover:text-signal">
                            {d.title}
                          </Link>
                          <p className="text-xs text-ink-3">{d.contact?.name}</p>
                        </TableCell>
                        <TableCell>
                          <StageBadge stage={d.stage} />
                        </TableCell>
                        <TableCell className="text-right tabular">{money(d.value)}</TableCell>
                        <TableCell>
                          <span className="flex items-center justify-end gap-2">
                            <RiskBadge risk={d.risk} />
                            <ScoreBadge score={d.score} breakdown={d.scoreBreakdown} />
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Link href="/deals" className="mt-3 inline-flex items-center gap-1 text-sm text-signal transition-colors hover:text-signal-hover">
                All deals <ArrowRight className="size-3.5" />
              </Link>
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0">
          <div className="quiet-scroll flex min-w-0 flex-col gap-6 xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6.5rem)] xl:overflow-y-auto xl:pr-1">
          <Card>
            <CardHeader>
              <CardTitle>Pipeline</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5">
              {data.pipeline.map((p) => (
                <div key={p.stage} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-ink-2">{p.stage}</span>
                    <span className="tabular text-ink-3">
                      {p.count} · {compactMoney(p.value)}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-sunk">
                    <div
                      className={cn(
                        "bar-fill h-full rounded-full",
                        p.stage === "Won" ? "bg-good" : p.stage === "Lost" ? "bg-bad" : p.stage === "Negotiation" ? "bg-caution" : "bg-signal",
                      )}
                      style={{ width: `${Math.max(p.count ? 3 : 0, (p.value / maxValue) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckSquare className="size-4 text-ink-3" /> Due this week
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.tasksDue.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line px-4 py-5 text-center text-sm text-ink-2">
                  Nothing due this week.
                </p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {data.tasksDue.map((t) => (
                    <TaskRow key={t.id} task={t} collapseOnDone />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
              <CardDescription>Every note is scored for sentiment and embedded for semantic search.</CardDescription>
            </CardHeader>
            <CardContent>
              <Timeline notes={data.recentActivity.slice(0, 5)} />
              {data.recentActivity.length > 0 && <p className="mt-3 text-xs text-ink-3">Latest {timeAgo(data.recentActivity[0].createdAt)}</p>}
            </CardContent>
          </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
