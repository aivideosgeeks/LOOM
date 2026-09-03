"use client";

import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { AssistantThread } from "@/components/assistant-thread";
import { Button } from "@/components/ui/button";

/**
 * The assistant, reachable from anywhere.
 *
 * A panel rather than a dialog: the point is to act on what is already on
 * screen, so covering the page would defeat it. It closes on Escape and on a
 * click outside, and the trigger stays in the same place so the gesture is
 * always the same one.
 */
export function AssistantFab() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      // Ctrl/Cmd+K is where people reach for a command surface first.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {open && (
        <>
          <button
            aria-label="Close assistant"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default bg-black/25 backdrop-blur-[2px]"
          />
          <div
            role="dialog"
            aria-label="Assistant"
            className="glass enter fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-line p-5 shadow-2xl sm:inset-y-3 sm:right-3 sm:rounded-2xl sm:border"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-lg leading-tight">Assistant</h2>
                <p className="text-xs text-ink-3">
                  Ask about your pipeline, or tell it what to do. It can add records and open them.
                </p>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setOpen(false)} aria-label="Close">
                <X className="size-4" />
              </Button>
            </div>
            <AssistantThread compact />
          </div>
        </>
      )}

      {/*
        Hidden while the panel is open: leaving it under the backdrop would be a
        second, dead-looking way to do what the close button already does.
      */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open assistant"
          className="beacon group fixed bottom-5 right-5 z-30 flex items-center gap-2.5 rounded-full border border-white/15 bg-gradient-to-br from-signal to-weft py-3 pl-4 pr-3.5 text-signal-foreground shadow-lg transition-transform duration-300 ease-out hover:-translate-y-0.5 active:translate-y-0 md:bottom-7 md:right-7"
        >
          <Sparkles className="size-5 shrink-0" />
          <span className="hidden text-sm font-medium tracking-tight sm:inline">Assistant</span>
          <kbd className="hidden rounded border border-white/25 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] leading-none text-white/80 sm:inline">
            ⌘K
          </kbd>
        </button>
      )}
    </>
  );
}
