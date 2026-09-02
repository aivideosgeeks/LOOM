"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { Stage } from "@loom/shared";
import { PIPELINE_STAGES } from "@loom/shared";
import { AlertTriangle, Bot, Building2, CalendarDays, Clock, RefreshCw, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { RiskBadge, ScoreBadge, ScoreBreakdownList, StageBadge } from "@/components/badges";
import { DraftEmailDialog } from "@/components/draft-email-dialog";
import { MeetingResultCard, SummarizeMeetingDialog } from "@/components/meeting-dialog";
import { PageHeader } from "@/components/page-header";
import { DealDialog } from "@/components/record-dialogs";
import { TasksPanel } from "@/components/tasks-panel";
import { NoteComposer, Timeline } from "@/components/timeline";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage } from "@/lib/api";
import { useDeal, useDeleteDeal, useRescoreDeal, useUpdateDeal } from "@/lib/hooks";
import { daysSince, formatDate, money, timeAgo } from "@/lib/format";

export default function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading } = useDeal(id);
  const update = useUpdateDeal(id);
  const rescore = useRescoreDeal(id);
  const del = useDeleteDeal();

  if (isLoading || !data) return <Skeleton className="h-96" />;
  const { deal, notes, tasks, meetings } = data;

  const changeStage = async (stage: Stage) => {
    try {
      await update.mutateAsync({ stage });
      toast.success(`Moved to ${stage}. Score and risk recalculating.`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${deal.title}" and its notes, tasks and meetings?`)) return;
    try {
      await del.mutateAsync(deal.id);
      toast.success("Deal deleted");
      router.push("/deals");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="enter-stack flex min-w-0 flex-col gap-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {deal.title}
            <ScoreBadge score={deal.score} breakdown={deal.scoreBreakdown} size="lg" />
            <RiskBadge risk={deal.risk} showReason />
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {deal.contact && (
              <Link href={`/contacts/${deal.contact.id}`} className="inline-flex items-center gap-1 hover:underline">
                <User className="size-3.5" /> {deal.contact.name}
              </Link>
            )}
            {deal.contact?.company && (
              <span className="inline-flex items-center gap-1">
                <Building2 className="size-3.5" /> {deal.contact.company}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" /> last activity {timeAgo(deal.lastActivityAt)}
            </span>
          </span>
        }
        actions={
          <>
            {deal.contact && <DraftEmailDialog deal={deal.id} recipientEmail={deal.contact.email} recipientName={deal.contact.name} />}
            <SummarizeMeetingDialog dealId={deal.id} />
            <DealDialog deal={deal} />
            <Button variant="ghost" size="icon" aria-label="Delete deal" onClick={remove}>
              <Trash2 className="size-4" />
            </Button>
          </>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Card>
            <CardContent className="grid gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-ink-3">Stage</p>
                <Select value={deal.stage} onValueChange={(v) => void changeStage(v as Stage)}>
                  <SelectTrigger size="sm" className="mt-1 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PIPELINE_STAGES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-ink-3">{daysSince(deal.stageEnteredAt)} days in stage</p>
              </div>
              <div>
                <p className="text-xs text-ink-3">Value</p>
                <p className="mt-1 text-lg font-semibold tabular">{money(deal.value)}</p>
              </div>
              <div>
                <p className="text-xs text-ink-3">Expected close</p>
                <p className="mt-1 inline-flex items-center gap-1 text-sm">
                  <CalendarDays className="size-3.5" /> {formatDate(deal.expectedCloseDate)}
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-3">Owner</p>
                <p className="mt-1 text-sm">{deal.owner?.name ?? "-"}</p>
              </div>
            </CardContent>
          </Card>

          {deal.risk?.atRisk && (
            <Card className="border-bad/30 bg-bad-wash/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-bad">
                  <AlertTriangle className="size-4" /> This deal is at risk
                </CardTitle>
                <CardDescription>
                  Flagged {formatDate(deal.risk.flaggedAt)} · last checked {timeAgo(deal.risk.checkedAt)} · {deal.risk.reasonSource === "ai" ? "explanation by Claude" : "rule-based explanation (AI offline)"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  {deal.risk.reasonSource === "ai" && <Bot className="mr-1 inline size-3.5 text-signal" />}
                  {deal.risk.aiReason}
                </p>
                {deal.risk.suggestedAction && (
                  <p>
                    <span className="font-medium">Suggested next step: </span>
                    {deal.risk.suggestedAction}
                  </p>
                )}
                <ul className="list-disc pl-5 text-ink-3">
                  {deal.risk.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue="timeline">
            <TabsList>
              <TabsTrigger value="timeline">Timeline ({notes.length})</TabsTrigger>
              <TabsTrigger value="tasks">Tasks ({tasks.filter((t) => !t.done).length})</TabsTrigger>
              <TabsTrigger value="meetings">Meetings ({meetings.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="timeline" className="space-y-4 pt-3">
              <NoteComposer deal={deal.id} />
              <Timeline notes={notes} />
            </TabsContent>
            <TabsContent value="tasks" className="pt-3">
              <TasksPanel tasks={tasks} deal={deal.id} />
            </TabsContent>
            <TabsContent value="meetings" className="space-y-3 pt-3">
              {meetings.length === 0 && <p className="text-sm text-ink-3">No meetings summarised yet. Use “Summarize meeting” to paste a transcript.</p>}
              {meetings.map((m) => (
                <MeetingResultCard key={m.id} meeting={m} />
              ))}
            </TabsContent>
          </Tabs>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Lead score</span>
                <Button variant="ghost" size="sm" onClick={() => rescore.mutateAsync().then(() => toast.success("Recomputed")).catch((e) => toast.error(errorMessage(e)))} disabled={rescore.isPending}>
                  <RefreshCw className={rescore.isPending ? "size-4 animate-spin" : "size-4"} /> Recompute
                </Button>
              </CardTitle>
              <CardDescription>{deal.scoredAt ? `Computed ${timeAgo(deal.scoredAt)}` : "Not scored yet, the background job is running."}</CardDescription>
            </CardHeader>
            <CardContent>
              {deal.scoreBreakdown ? <ScoreBreakdownList breakdown={deal.scoreBreakdown} /> : <Skeleton className="h-32" />}
              <p className="mt-3 text-xs text-ink-3">Stage prior + recency + value + stage velocity + note sentiment (classified by Claude) + engagement. Re-scored whenever the deal or its notes change.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Stage history</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <StageBadge stage={deal.stage} />
                <span className="text-ink-3">since {formatDate(deal.stageEnteredAt)}</span>
              </div>
              <p className="text-xs text-ink-3">Created {formatDate(deal.createdAt)}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
