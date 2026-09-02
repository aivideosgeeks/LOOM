"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Building2, Copy, Mail, Phone, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { RiskBadge, ScoreBadge, StageBadge } from "@/components/badges";
import { DraftEmailDialog } from "@/components/draft-email-dialog";
import { PageHeader } from "@/components/page-header";
import { ContactDialog, DealDialog } from "@/components/record-dialogs";
import { TasksPanel } from "@/components/tasks-panel";
import { NoteComposer, Timeline } from "@/components/timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage } from "@/lib/api";
import { useContact, useDeleteContact, useMe } from "@/lib/hooks";
import { formatDate, money, timeAgo } from "@/lib/format";

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading } = useContact(id);
  const { data: me } = useMe();
  const del = useDeleteContact();

  if (isLoading || !data) return <Skeleton className="h-96" />;
  const { contact, deals, notes, tasks } = data;

  const remove = async () => {
    if (!window.confirm(`Delete ${contact.name} and all related deals, notes and tasks?`)) return;
    try {
      await del.mutateAsync(contact.id);
      toast.success("Contact deleted");
      router.push("/contacts");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="enter-stack flex min-w-0 flex-col gap-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {contact.name}
            <ScoreBadge score={contact.score} size="lg" />
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {contact.company && (
              <span className="inline-flex items-center gap-1">
                <Building2 className="size-3.5" /> {contact.company}
              </span>
            )}
            {contact.email && (
              <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1 hover:underline">
                <Mail className="size-3.5" /> {contact.email}
              </a>
            )}
            {contact.phone && (
              <span className="inline-flex items-center gap-1">
                <Phone className="size-3.5" /> {contact.phone}
              </span>
            )}
            <span>· owner {contact.owner?.name ?? "-"}</span>
          </span>
        }
        actions={
          <>
            <DraftEmailDialog contact={contact.id} recipientEmail={contact.email} recipientName={contact.name} />
            <DealDialog
              defaultContact={{ id: contact.id, name: contact.name }}
              trigger={
                <Button variant="outline" size="sm" className="gap-2">
                  <Plus className="size-4" /> New deal
                </Button>
              }
            />
            <ContactDialog contact={contact} />
            <Button variant="ghost" size="icon" aria-label="Delete contact" onClick={remove}>
              <Trash2 className="size-4" />
            </Button>
          </>
        }
      />

      {me?.user.role === "admin" && (contact.duplicateCandidates ?? 0) > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-caution/35 bg-caution-wash p-3 text-sm">
          <Copy className="size-4 text-caution" />
          <span>
            This contact has {contact.duplicateCandidates} possible duplicate{contact.duplicateCandidates === 1 ? "" : "s"} waiting for review.
          </span>
          <Link href="/duplicates" className="ml-auto font-medium text-signal hover:underline">
            Review
          </Link>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Deals ({deals.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {deals.length === 0 ? (
                <p className="text-sm text-ink-3">No deals yet.</p>
              ) : (
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
                    {deals.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>
                          <Link href={`/deals/${d.id}`} className="font-medium hover:underline">
                            {d.title}
                          </Link>
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
              )}
            </CardContent>
          </Card>

          <Tabs defaultValue="timeline">
            <TabsList>
              <TabsTrigger value="timeline">Timeline ({notes.length})</TabsTrigger>
              <TabsTrigger value="tasks">Tasks ({tasks.filter((t) => !t.done).length})</TabsTrigger>
            </TabsList>
            <TabsContent value="timeline" className="space-y-4 pt-3">
              <NoteComposer contact={contact.id} />
              <Timeline notes={notes} />
            </TabsContent>
            <TabsContent value="tasks" className="pt-3">
              <TasksPanel tasks={tasks} contact={contact.id} />
            </TabsContent>
          </Tabs>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-ink-3">Tags</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {contact.tags.length ? contact.tags.map((t) => <Badge key={t} variant="outline">{t}</Badge>) : <span className="text-ink-3">none</span>}
                </div>
              </div>
              <div>
                <p className="text-xs text-ink-3">Notes</p>
                <p className="mt-1 whitespace-pre-wrap">{contact.notes ?? <span className="text-ink-3">none</span>}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-ink-3">
                <span>Last touch {timeAgo(contact.lastActivityAt)}</span>
                <span>Created {formatDate(contact.createdAt)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
