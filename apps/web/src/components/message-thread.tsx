"use client";

import { useEffect, useRef, useState } from "react";
import type { IntegrationPlatform, PlatformMessageDTO } from "@loom/shared";
import { PLATFORM_CAPABILITIES } from "@loom/shared";
import { AlertCircle, Loader2, SendHorizonal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api";
import { useMessages, useSendMessage } from "@/lib/hooks";
import { timeAgo } from "@/lib/format";

/**
 * The conversation with a contact on a connected platform.
 *
 * Polled rather than pushed: there is no socket between the CRM and Meta, and
 * a poll is what the briefs ask for. Outbound messages are written before the
 * send is attempted and updated with the result, so a delivery failure stays
 * visible in the thread instead of the message quietly disappearing.
 */
export function MessageThread({ contactId, platforms }: { contactId: string; platforms: IntegrationPlatform[] }) {
  const { data, isLoading } = useMessages(contactId);
  const send = useSendMessage(contactId);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const messages = data?.messages ?? [];

  // Platforms this contact has actually written from; replying anywhere else
  // would have nobody to reach.
  const available = platforms.filter((p) => PLATFORM_CAPABILITIES[p].messaging);
  const seen = Array.from(new Set(messages.map((m) => m.platform))).filter((p) => PLATFORM_CAPABILITIES[p].messaging);
  const options = seen.length > 0 ? seen : available;
  const [platform, setPlatform] = useState<IntegrationPlatform | null>(options[0] ?? null);

  useEffect(() => {
    if (!platform && options.length > 0) setPlatform(options[0]!);
  }, [options, platform]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || !platform) return;
    setError(null);
    setText("");
    try {
      const result = await send.mutateAsync({ platform, text: trimmed });
      if (result.message.deliveryStatus === "failed") setError(result.message.deliveryError ?? "The message could not be delivered.");
    } catch (err) {
      setError(errorMessage(err));
      setText(trimmed);
    }
  };

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-ink-3">
        <Loader2 className="size-4 animate-spin" /> Loading conversation…
      </p>
    );
  }

  if (messages.length === 0 && options.length === 0) {
    return (
      <p className="py-6 text-sm text-ink-3">
        No connected messaging platform. Connect Instagram or Facebook under Admin → Integrations, and conversations
        will appear here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="quiet-scroll max-h-96 space-y-2 overflow-y-auto pr-1">
        {messages.length === 0 && <p className="py-4 text-sm text-ink-3">No messages yet.</p>}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        <div ref={endRef} />
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-md border border-bad/40 bg-bad-wash px-3 py-2 text-xs text-bad">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex gap-2"
      >
        {options.length > 1 && (
          <select
            value={platform ?? ""}
            onChange={(e) => setPlatform(e.target.value as IntegrationPlatform)}
            aria-label="Reply on"
            className="rounded-md border border-line bg-background px-2 text-sm"
          >
            {options.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_CAPABILITIES[p].label}
              </option>
            ))}
          </select>
        )}
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={platform ? `Reply on ${PLATFORM_CAPABILITIES[platform].label}…` : "No platform to reply on"}
          disabled={!platform || send.isPending}
        />
        <Button type="submit" disabled={!platform || !text.trim() || send.isPending} className="gap-1.5">
          <SendHorizonal className="size-4" />
          {send.isPending ? "Sending…" : "Send"}
        </Button>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: PlatformMessageDTO }) {
  const outbound = message.direction === "out";
  const failed = message.deliveryStatus === "failed";

  return (
    <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[80%] space-y-1">
        <div
          className={[
            "rounded-2xl px-3.5 py-2 text-sm",
            outbound ? "rounded-br-sm bg-primary text-signal-foreground" : "rounded-bl-sm border bg-paper",
            failed ? "opacity-60 ring-1 ring-bad" : "",
          ].join(" ")}
        >
          {message.text}
        </div>
        <div className={`flex items-center gap-1.5 text-[11px] text-ink-3 ${outbound ? "justify-end" : ""}`}>
          <Badge variant="outline" className="text-[10px]">
            {PLATFORM_CAPABILITIES[message.platform].label}
          </Badge>
          <span>{timeAgo(message.sentAt)}</span>
          {message.sentBy && <span>· {message.sentBy.name}</span>}
          {failed && <span className="text-bad">· not delivered</span>}
          {message.deliveryStatus === "pending" && <span>· sending</span>}
        </div>
      </div>
    </div>
  );
}
