"use client";

import { useRef, useState } from "react";
import type { MeetingDTO } from "@loom/shared";
import { CheckSquare, FileUp, ListChecks, Mic, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AiSourceBadge, SentimentBadge } from "@/components/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/api";
import { useCreateMeeting, useMeeting } from "@/lib/hooks";
import { formatDate } from "@/lib/format";

export function MeetingResultCard({ meeting }: { meeting: MeetingDTO }) {
  const r = meeting.result;
  const inProgress = meeting.status === "pending" || meeting.status === "processing";
  return (
    <div className="space-y-3 rounded-lg border bg-paper p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{meeting.title}</p>
          <p className="text-xs text-ink-3">{formatDate(meeting.createdAt, "d MMM yyyy, HH:mm")}</p>
        </div>
        <div className="flex items-center gap-2">
          {inProgress && (
            <Badge variant="secondary" className="gap-1">
              <RefreshCw className="size-3 animate-spin" /> {meeting.status === "processing" ? "Summarising…" : "Queued"}
            </Badge>
          )}
          {meeting.status === "failed" && <Badge variant="destructive">Failed</Badge>}
          {meeting.status === "done" && <AiSourceBadge source={meeting.source === "ai" ? "ai" : "fallback"} />}
          {r?.sentiment && <SentimentBadge sentiment={r.sentiment} />}
        </div>
      </div>
      {meeting.error && <p className="text-xs text-caution">{meeting.error}</p>}
      {r && (
        <>
          <p className="text-sm whitespace-pre-wrap">{r.summary}</p>
          {r.keyTopics.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {r.keyTopics.map((t) => (
                <Badge key={t} variant="outline">
                  {t}
                </Badge>
              ))}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-ink-3 uppercase">
                <CheckSquare className="size-3" /> Action items ({r.actionItems.length})
              </p>
              <ul className="space-y-1 text-sm">
                {r.actionItems.map((a, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-ink-3">•</span>
                    <span>
                      {a.title}
                      {(a.owner || a.dueDate) && (
                        <span className="text-xs text-ink-3">
                          {" "}
                          ({[a.owner, a.dueDate ? `due ${a.dueDate}` : null].filter(Boolean).join(", ")})
                        </span>
                      )}
                    </span>
                  </li>
                ))}
                {r.actionItems.length === 0 && <li className="text-ink-3">None extracted</li>}
              </ul>
            </div>
            <div>
              <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-ink-3 uppercase">
                <ListChecks className="size-3" /> Next steps
              </p>
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {r.nextSteps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
                {r.nextSteps.length === 0 && <li className="list-none text-ink-3">None extracted</li>}
              </ol>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function SummarizeMeetingDialog({ dealId }: { dealId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [transcript, setTranscript] = useState("");
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const create = useCreateMeeting(dealId);
  const { data } = useMeeting(meetingId);
  const meeting = data?.meeting ?? null;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setTranscript(text);
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
  };

  const submit = async () => {
    try {
      const res = await create.mutateAsync({ title: title.trim() || undefined, transcript: transcript.trim() });
      setMeetingId(res.meeting.id);
      toast.success("Transcript queued. Summary, action items and sentiment will appear shortly.");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const reset = () => {
    setMeetingId(null);
    setTranscript("");
    setTitle("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Mic className="size-4" /> Summarize meeting
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Summarize a call or meeting</DialogTitle>
          <DialogDescription>Paste or upload a transcript. Claude extracts a summary, action items (added as tasks), sentiment (feeds the lead score) and next steps.</DialogDescription>
        </DialogHeader>

        {!meeting ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div className="space-y-1">
                <Label htmlFor="mtitle">Title</Label>
                <Input id="mtitle" placeholder="e.g. Proposal review with Marcus" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="flex items-end">
                <input ref={fileRef} type="file" accept=".txt,.md,.vtt,.srt,text/plain" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
                <Button variant="outline" onClick={() => fileRef.current?.click()} className="gap-2">
                  <FileUp className="size-4" /> Upload .txt / .vtt
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="transcript">Transcript</Label>
              <Textarea id="transcript" rows={12} placeholder="Paste the call transcript here…" value={transcript} onChange={(e) => setTranscript(e.target.value)} />
              <p className="text-xs text-ink-3">{transcript.length.toLocaleString()} characters</p>
            </div>
            <DialogFooter>
              <Button onClick={submit} disabled={create.isPending || transcript.trim().length < 20}>
                {create.isPending ? "Queuing…" : "Summarize"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <MeetingResultCard meeting={meeting} />
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                Summarize another
              </Button>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
