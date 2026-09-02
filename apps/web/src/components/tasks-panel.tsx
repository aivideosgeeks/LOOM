"use client";

import { useState } from "react";
import type { TaskDTO } from "@loom/shared";
import { Bot, CalendarClock, Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api";
import { useCreateTask, useUpdateTask } from "@/lib/hooks";
import { daysUntil, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A task row. Ticking it flips instantly, then the row either collapses out of
 * the list (`collapseOnDone`, where the list only holds open tasks) or stays put
 * and moves to the completed group. Either way the feedback is immediate and the
 * closing gap is visible rather than a sudden jump.
 */
export function TaskRow({ task, showContext, collapseOnDone = false }: { task: TaskDTO; showContext?: React.ReactNode; collapseOnDone?: boolean }) {
  const update = useUpdateTask();
  const [done, setDone] = useState(task.done);
  const [leaving, setLeaving] = useState(false);
  const due = daysUntil(task.dueDate);

  const toggle = async (next: boolean) => {
    setDone(next);
    if (next && collapseOnDone) setLeaving(true);
    try {
      await update.mutateAsync({ id: task.id, done: next });
    } catch (err) {
      setDone(!next);
      setLeaving(false);
      toast.error(errorMessage(err));
    }
  };

  return (
    <label
      className={cn(
        "row-hover group flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 text-sm hover:bg-sunk",
        leaving && "task-exit",
      )}
    >
      <span className="relative mt-0.5 inline-flex size-4 shrink-0 items-center justify-center">
        <input
          type="checkbox"
          className="peer absolute inset-0 cursor-pointer opacity-0"
          checked={done}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span
          className={cn(
            "pointer-events-none flex size-4 items-center justify-center rounded-[5px] border transition-all duration-200",
            done ? "border-signal bg-signal text-primary-foreground" : "border-line-strong bg-paper group-hover:border-signal/60",
          )}
        >
          <Check className={cn("size-3 transition-all duration-200", done ? "scale-100 opacity-100" : "scale-50 opacity-0")} strokeWidth={3} />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block transition-all duration-300", done && "text-ink-3 line-through")}>{task.title}</span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
          {task.source === "meeting" && (
            <span className="inline-flex items-center gap-1 text-signal">
              <Bot className="size-3" /> from meeting
            </span>
          )}
          {task.dueDate && (
            <span
              className={cn(
                "inline-flex items-center gap-1 transition-colors duration-200",
                !done && due !== null && due < 0 && "text-bad",
                !done && due !== null && due >= 0 && due <= 2 && "text-caution",
              )}
            >
              <CalendarClock className="size-3" /> {formatDate(task.dueDate)}
              {!done && due !== null && (due < 0 ? ` · ${-due}d overdue` : due === 0 ? " · today" : ` · in ${due}d`)}
            </span>
          )}
          {showContext}
        </span>
      </span>
    </label>
  );
}

export function TasksPanel({ tasks, deal, contact }: { tasks: TaskDTO[]; deal?: string; contact?: string }) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const create = useCreateTask();

  const add = async () => {
    if (!title.trim()) return;
    try {
      await create.mutateAsync({ title: title.trim(), deal, contact, dueDate: dueDate || null });
      setTitle("");
      setDueDate("");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Input placeholder="Add a task…" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
        <Input type="date" className="w-40" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Due date" />
        <Button size="icon" variant="outline" onClick={add} disabled={!title.trim() || create.isPending} aria-label="Add task">
          <Plus className="size-4" />
        </Button>
      </div>

      {open.length === 0 && done.length === 0 && (
        <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-ink-2">
          No tasks yet. Action items from a meeting summary land here automatically.
        </p>
      )}

      {open.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {open.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </div>
      )}

      {done.length > 0 && (
        <details className="group text-sm">
          <summary className="cursor-pointer list-none text-ink-3 transition-colors hover:text-ink-2">
            <span className="inline-block transition-transform duration-200 group-open:rotate-90">›</span> {done.length} completed
          </summary>
          <div className="mt-1 flex flex-col gap-0.5">
            {done.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
