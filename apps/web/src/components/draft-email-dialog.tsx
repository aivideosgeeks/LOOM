"use client";

import { useState } from "react";
import type { EmailDraft, EmailTone } from "@loom/shared";
import { EMAIL_TONES } from "@loom/shared";
import { Copy, ExternalLink, Mail, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AiSourceBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/api";
import { useDraftEmail, useSendEmail } from "@/lib/hooks";

interface Props {
  deal?: string;
  contact?: string;
  recipientEmail: string | null;
  recipientName: string;
}

/** "Draft follow-up": Claude proposes, the human edits, nothing is sent without an explicit click. */
export function DraftEmailDialog({ deal, contact, recipientEmail, recipientName }: Props) {
  const [open, setOpen] = useState(false);
  const [tone, setTone] = useState<EmailTone>("professional");
  const [intent, setIntent] = useState("");
  const [draft, setDraft] = useState<EmailDraft | null>(null);
  const [to, setTo] = useState(recipientEmail ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const drafting = useDraftEmail({ deal, contact });
  const sending = useSendEmail({ deal, contact });

  const generate = async () => {
    try {
      const res = await drafting.mutateAsync({ tone, intent: intent.trim() || undefined });
      setDraft(res.draft);
      setSubject(res.draft.subject);
      setBody(res.draft.body);
      if (res.draft.source === "template") toast.warning("AI is unavailable; showing a template you can edit.");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const send = async () => {
    try {
      const res = await sending.mutateAsync({ to, subject, body });
      toast.success(res.sent ? "Email sent and logged to the timeline." : `Logged to the timeline. ${res.detail}`);
      setOpen(false);
      setDraft(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setTo(recipientEmail ?? "");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="default" size="sm" className="gap-2">
          <Sparkles className="size-4" /> Draft follow-up
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Draft a follow-up to {recipientName}</DialogTitle>
          <DialogDescription>Claude uses the deal stage, notes, meetings and open tasks to write a personalised draft. Edit freely; nothing is sent until you click Send.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-[1fr_160px_auto]">
          <div className="space-y-1">
            <Label htmlFor="intent">What should this email do? (optional)</Label>
            <Input id="intent" placeholder="e.g. nudge on the revised pricing, propose a call next week" value={intent} onChange={(e) => setIntent(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Tone</Label>
            <Select value={tone} onValueChange={(v) => setTone(v as EmailTone)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMAIL_TONES.map((t) => (
                  <SelectItem key={t} value={t} className="capitalize">
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button onClick={generate} disabled={drafting.isPending} className="gap-2">
              {drafting.isPending ? <RefreshCw className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {draft ? "Regenerate" : "Generate"}
            </Button>
          </div>
        </div>

        {drafting.isPending && <p className="text-sm text-ink-3">Reading the deal history and writing a draft… this can take up to a minute.</p>}

        {draft && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <AiSourceBadge source={draft.source} />
              {draft.reasoning && <span className="text-xs text-ink-3">{draft.reasoning}</span>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="to">To</Label>
                <Input id="to" type="email" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="subject">Subject</Label>
                <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="body">Body</Label>
              <Textarea id="body" rows={12} value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
          </div>
        )}

        {draft && (
          <DialogFooter className="gap-2 sm:justify-between">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`).then(() => toast.success("Copied"))}
              >
                <Copy className="size-4" /> Copy
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={mailto} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" /> Open in mail client
                </a>
              </Button>
            </div>
            <Button onClick={send} disabled={sending.isPending || !to || !subject || !body} className="gap-2">
              <Mail className="size-4" /> {sending.isPending ? "Sending…" : "Send & log to timeline"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
