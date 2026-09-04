"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Plug, BarChart3, Bot, CircleDot, Contact, Copy, Handshake, LayoutDashboard, ListTodo, LogOut, MessageSquareText, Search, Sparkles, Users } from "lucide-react";
import { AssistantFab } from "@/components/assistant-fab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAiStatus, useLogout, useMe } from "@/lib/hooks";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/deals", label: "Deals", icon: Handshake },
  { href: "/contacts", label: "Contacts", icon: Contact },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
  { href: "/ask", label: "Ask your CRM", icon: MessageSquareText, ai: true },
  { href: "/search", label: "Semantic search", icon: Search, ai: true },
];

const ADMIN_NAV = [
  { href: "/admin/team", label: "Team", icon: Users },
  { href: "/admin/integrations", label: "Integrations", icon: Plug },
  { href: "/duplicates", label: "Duplicates", icon: Copy, ai: true },
  { href: "/admin/ai-usage", label: "AI usage", icon: BarChart3 },
];

function AiStatusPill() {
  const { data } = useAiStatus();
  if (!data) return null;
  const online = data.configured && data.circuit !== "open";
  const label = !data.configured ? "AI offline · fallback mode" : data.circuit === "open" ? "AI degraded · circuit open" : `Claude · ${data.model}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors duration-200",
            online ? "border-good/30 bg-good-wash text-good" : "border-caution/30 bg-caution-wash text-caution",
          )}
        >
          <CircleDot className="size-3" />
          <span className="hidden sm:inline">{label}</span>
          <Bot className="size-3 sm:hidden" />
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">
        <p>LLM: {data.configured ? `${data.provider} (${data.model}), circuit ${data.circuit}` : "not configured, set ANTHROPIC_API_KEY. Features use deterministic fallbacks."}</p>
        <p>
          Embeddings: {data.embeddings.provider} ({data.embeddings.model}) {data.embeddings.ready ? "ready" : "loading"}
        </p>
        <p>
          Vector store: {data.vectorStore.provider} {data.vectorStore.healthy ? "healthy" : "unreachable"} · Queue: {data.queue.provider}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: me } = useMe();
  const logout = useLogout();
  const isAdmin = me?.user.role === "admin";

  const signOut = async () => {
    await logout.mutateAsync();
    router.replace("/login");
    router.refresh();
  };

  const navItem = (item: { href: string; label: string; icon: typeof LayoutDashboard; ai?: boolean }) => {
    const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-all duration-200",
          active ? "nav-mark bg-signal-wash font-medium text-signal" : "text-ink-2 hover:bg-sunk hover:text-ink",
        )}
      >
        <item.icon className={cn("size-4 shrink-0 transition-transform duration-200", !active && "group-hover:scale-110")} />
        <span className="flex-1">{item.label}</span>
        {item.ai && <Sparkles className={cn("size-3 transition-opacity duration-200", active ? "opacity-90" : "opacity-45 group-hover:opacity-80")} />}
      </Link>
    );
  };

  return (
    <div className="min-h-screen">
      {/* Fixed rail: it owns its own scroll, so the page never carries it away. */}
      <aside className="glass quiet-scroll fixed inset-y-0 left-0 z-30 hidden w-60 flex-col overflow-y-auto border-r border-line p-4 md:flex">
        <Link href="/" className="mb-7 flex items-center gap-2.5 px-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-signal text-primary-foreground shadow-sm">
            <Sparkles className="size-4" />
          </div>
          <div>
            <p className="font-display text-lg leading-none">LOOM</p>
            <p className="mt-1 text-[11px] text-ink-3">CRM that closes deals</p>
          </div>
        </Link>

        <nav className="flex flex-col gap-1">{NAV.map(navItem)}</nav>

        {isAdmin && (
          <>
            <p className="mt-7 mb-2 px-3 font-mono text-[10px] tracking-[0.14em] text-ink-3 uppercase">Admin</p>
            <nav className="flex flex-col gap-1">{ADMIN_NAV.map(navItem)}</nav>
          </>
        )}

        <p className="mt-auto px-2 pt-8 text-[11px] leading-relaxed text-ink-3">
          Scores, risk flags and summaries refresh in the background as the pipeline changes.
        </p>
      </aside>

      {/* Main column is offset by the rail rather than sitting beside it in flow. */}
      <div className="flex min-h-screen min-w-0 flex-col md:pl-60">
        <header className="glass sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-line px-4 md:px-8">
          <nav className="quiet-scroll flex items-center gap-1 overflow-x-auto md:hidden">
            {[...NAV, ...(isAdmin ? ADMIN_NAV : [])].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-2 py-1 text-xs whitespace-nowrap transition-colors duration-200",
                  pathname === item.href ? "bg-signal-wash text-signal" : "text-ink-2",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <AiStatusPill />
            {me && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-2 px-2 transition-colors duration-200">
                    <span className="flex size-7 items-center justify-center rounded-full bg-signal-wash text-xs font-semibold text-signal">{initials(me.user.name)}</span>
                    <span className="hidden text-sm sm:inline">{me.user.name}</span>
                    <Badge variant="outline" className="hidden capitalize sm:inline-flex">
                      {me.user.role}
                    </Badge>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>
                    <p className="text-sm">{me.user.name}</p>
                    <p className="text-xs font-normal text-ink-3">{me.user.email}</p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={signOut}>
                    <LogOut className="size-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </header>

        <main key={pathname} className="enter flex-1 p-4 md:p-8">
          {children}
        </main>
        {/* Reachable from every page, since the point is to act on whatever is already open. */}
        <AssistantFab />
      </div>
    </div>
  );
}
