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
 * click outside, and the button stays put so the same gesture always works.
 */
export function AssistantFab() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Cmd/Ctrl+K opens it from anywhere, which is where people reach first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
            className="fixed inset-0 z-40 cursor-default bg-black/20 backdrop-blur-[1px]"
          />
          <div
            role="dialog"
            aria-label="Assistant"
            className="glass enter fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-line p-5 shadow-2xl sm:inset-y-3 sm:right-3 sm:rounded-2xl sm:border"
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg">Assistant</h2>
                <p className="text-xs text-ink-3">Ask, or tell it what to do. It can add records and open them.</p>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setOpen(false)} aria-label="Close">
                <X className="size-4" />
              </Button>
            </div>
            <AssistantThread compact />
          </div>
        </>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Open assistant"
        title="Assistant (Ctrl+K)"
        className="lift fixed bottom-5 right-5 z-30 flex size-13 items-center justify-center rounded-full bg-primary text-signal-foreground shadow-lg transition hover:scale-105 active:scale-95"
      >
        <Sparkles className="size-5" />
      </button>
    </>
  );
}
