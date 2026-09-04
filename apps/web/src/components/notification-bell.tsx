"use client";

import { useState } from "react";
import Link from "next/link";
import type { NotificationDTO } from "@loom/shared";
import { AlertTriangle, Bell, CheckCheck, Copy, Inbox, MessageSquare, Sparkles, TriangleAlert, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from "@/lib/hooks";
import { timeAgo } from "@/lib/format";

const ICONS: Record<NotificationDTO["kind"], typeof Bell> = {
  deal_risk: TriangleAlert,
  lead_received: UserPlus,
  message_received: MessageSquare,
  duplicate_found: Copy,
  task_due: Inbox,
  meeting_summarized: Sparkles,
  integration_error: AlertTriangle,
};

/**
 * The bell.
 *
 * Everything the CRM works out on its own happens in a background job, so
 * without this the only way to learn a deal went risky is to notice a number
 * changed. Unread ones are marked read on click rather than on open, so opening
 * the list to glance at it does not silently clear it.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const items = data?.items ?? [];
  const unread = data?.unread ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}>
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-signal text-[10px] font-medium text-signal-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {unread > 0 && (
            <Button size="sm" variant="ghost" onClick={() => void markAll.mutateAsync()} className="h-7 gap-1.5 text-xs text-ink-3">
              <CheckCheck className="size-3.5" /> Mark all read
            </Button>
          )}
        </div>

        <div className="quiet-scroll max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-ink-3">
              Nothing yet. Risk flags, new leads and incoming messages appear here.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((n) => {
                const Icon = ICONS[n.kind] ?? Bell;
                const body = (
                  <div className={`flex gap-2.5 px-3 py-2.5 ${n.readAt ? "opacity-60" : ""}`}>
                    <Icon className={`mt-0.5 size-4 shrink-0 ${n.readAt ? "text-ink-3" : "text-signal"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-snug">{n.title}</p>
                      {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-ink-3">{n.body}</p>}
                      <p className="mt-1 text-[11px] text-ink-3">{timeAgo(n.createdAt)}</p>
                    </div>
                    {!n.readAt && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-signal" />}
                  </div>
                );

                return (
                  <li key={n.id} className="row-hover">
                    {n.href ? (
                      <Link
                        href={n.href}
                        onClick={() => {
                          if (!n.readAt) void markRead.mutateAsync(n.id);
                          setOpen(false);
                        }}
                        className="block"
                      >
                        {body}
                      </Link>
                    ) : (
                      <button type="button" onClick={() => !n.readAt && void markRead.mutateAsync(n.id)} className="block w-full text-left">
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-line px-3 py-2">
            <Badge variant="outline" className="text-[10px]">
              Kept for 60 days
            </Badge>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
