"use client";

import Link from "next/link";
import { ListTodo } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page-header";
import { TaskRow } from "@/components/tasks-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTasks } from "@/lib/hooks";

export default function TasksPage() {
  const { data, isLoading } = useTasks({});
  if (isLoading || !data) return <Skeleton className="h-64" />;
  const open = data.tasks.filter((t) => !t.done);
  const done = data.tasks.filter((t) => t.done);

  const context = (t: { deal: string | null; contact: string | null }) =>
    t.deal ? (
      <Link href={`/deals/${t.deal}`} className="hover:underline">
        open deal
      </Link>
    ) : t.contact ? (
      <Link href={`/contacts/${t.contact}`} className="hover:underline">
        open contact
      </Link>
    ) : null;

  return (
    <div className="enter-stack mx-auto max-w-3xl">
      <PageHeader title="Tasks" description="Manual tasks plus action items extracted from meeting transcripts." />
      {data.tasks.length === 0 ? (
        <EmptyState icon={ListTodo} title="No tasks yet" description="Add tasks from a deal or contact, or summarise a meeting to extract action items." />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Open ({open.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-0.5">
              {open.map((t) => (
                <TaskRow key={t.id} task={t} showContext={context(t)} />
              ))}
              {open.length === 0 && <p className="text-sm text-ink-3">All caught up.</p>}
            </CardContent>
          </Card>
          {done.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Completed ({done.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-0.5">
                {done.map((t) => (
                  <TaskRow key={t.id} task={t} showContext={context(t)} />
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
