"use client";

import { useEffect, useState } from "react";
import type { ContactDTO, DealDTO, Stage } from "@loom/shared";
import { PIPELINE_STAGES } from "@loom/shared";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/api";
import { useContacts, useCreateContact, useCreateDeal, useMe, useUpdateContact, useUpdateDeal, useUsers } from "@/lib/hooks";
import { toDateInput } from "@/lib/format";

function OwnerSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: me } = useMe();
  const { data } = useUsers();
  if (me?.user.role !== "admin") return null;
  return (
    <div className="space-y-1">
      <Label>Owner</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Assign owner" />
        </SelectTrigger>
        <SelectContent>
          {data?.users.map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.name} ({u.role})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ContactDialog({ contact, onSaved, trigger }: { contact?: ContactDTO; onSaved?: (c: ContactDTO) => void; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "", tags: "", notes: "", owner: "" });
  const create = useCreateContact();
  const update = useUpdateContact(contact?.id ?? "");
  const pending = create.isPending || update.isPending;

  useEffect(() => {
    if (open) {
      setForm({
        name: contact?.name ?? "",
        email: contact?.email ?? "",
        phone: contact?.phone ?? "",
        company: contact?.company ?? "",
        tags: contact?.tags.join(", ") ?? "",
        notes: contact?.notes ?? "",
        owner: contact?.owner?.id ?? "",
      });
    }
  }, [open, contact]);

  const submit = async () => {
    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      company: form.company.trim(),
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      notes: form.notes,
      ...(form.owner ? { owner: form.owner } : {}),
    };
    try {
      const res = contact ? await update.mutateAsync(payload) : await create.mutateAsync(payload);
      toast.success(contact ? "Contact updated" : "Contact created. Checking for duplicates in the background.");
      setOpen(false);
      onSaved?.(res.contact);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [key]: e.target.value })) });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" className="gap-2">
            {contact ? <Pencil className="size-4" /> : <Plus className="size-4" />} {contact ? "Edit" : "New contact"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{contact ? "Edit contact" : "New contact"}</DialogTitle>
          <DialogDescription>New and updated contacts are checked against existing records for likely duplicates.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="c-name">Name</Label>
            <Input id="c-name" required {...field("name")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="c-email">Email</Label>
            <Input id="c-email" type="email" {...field("email")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="c-phone">Phone</Label>
            <Input id="c-phone" {...field("phone")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="c-company">Company</Label>
            <Input id="c-company" {...field("company")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="c-tags">Tags (comma separated)</Label>
            <Input id="c-tags" placeholder="enterprise, champion" {...field("tags")} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="c-notes">Profile notes</Label>
            <Textarea id="c-notes" rows={3} {...field("notes")} />
          </div>
          <div className="sm:col-span-2">
            <OwnerSelect value={form.owner} onChange={(owner) => setForm((f) => ({ ...f, owner }))} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || !form.name.trim()}>
            {pending ? "Saving…" : contact ? "Save changes" : "Create contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DealDialog({ deal, defaultContact, onSaved, trigger }: { deal?: DealDTO; defaultContact?: { id: string; name: string }; onSaved?: (d: DealDTO) => void; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [contactQuery, setContactQuery] = useState("");
  const [form, setForm] = useState({ title: "", contact: "", value: "", stage: "Lead" as Stage, expectedCloseDate: "", owner: "" });
  const contacts = useContacts({ q: contactQuery, limit: 20 });
  const create = useCreateDeal();
  const update = useUpdateDeal(deal?.id ?? "");
  const pending = create.isPending || update.isPending;

  useEffect(() => {
    if (open) {
      setForm({
        title: deal?.title ?? "",
        contact: deal?.contact?.id ?? defaultContact?.id ?? "",
        value: deal ? String(deal.value) : "",
        stage: deal?.stage ?? "Lead",
        expectedCloseDate: toDateInput(deal?.expectedCloseDate),
        owner: deal?.owner?.id ?? "",
      });
    }
  }, [open, deal, defaultContact]);

  const submit = async () => {
    const payload = {
      title: form.title.trim(),
      contact: form.contact,
      value: Number(form.value || 0),
      stage: form.stage,
      expectedCloseDate: form.expectedCloseDate || null,
      ...(form.owner ? { owner: form.owner } : {}),
    };
    try {
      const res = deal ? await update.mutateAsync(payload) : await create.mutateAsync(payload);
      toast.success(deal ? "Deal updated. Score recalculating." : "Deal created. Scoring in the background.");
      setOpen(false);
      onSaved?.(res.deal);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const contactOptions = contacts.data?.items ?? [];
  const selectedKnown = contactOptions.some((c) => c.id === form.contact);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" className="gap-2">
            {deal ? <Pencil className="size-4" /> : <Plus className="size-4" />} {deal ? "Edit" : "New deal"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{deal ? "Edit deal" : "New deal"}</DialogTitle>
          <DialogDescription>Every change re-runs lead scoring and risk checks in the background.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="d-title">Title</Label>
            <Input id="d-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Contact</Label>
            <Input placeholder="Search contacts…" value={contactQuery} onChange={(e) => setContactQuery(e.target.value)} className="mb-1" />
            <Select value={form.contact} onValueChange={(contact) => setForm((f) => ({ ...f, contact }))}>
              <SelectTrigger>
                <SelectValue placeholder="Select a contact" />
              </SelectTrigger>
              <SelectContent>
                {!selectedKnown && form.contact && (
                  <SelectItem value={form.contact}>{deal?.contact?.name ?? defaultContact?.name ?? "Current contact"}</SelectItem>
                )}
                {contactOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.company ? ` · ${c.company}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="d-value">Value (USD)</Label>
            <Input id="d-value" type="number" min={0} value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>Stage</Label>
            <Select value={form.stage} onValueChange={(stage) => setForm((f) => ({ ...f, stage: stage as Stage }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PIPELINE_STAGES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="d-close">Expected close</Label>
            <Input id="d-close" type="date" value={form.expectedCloseDate} onChange={(e) => setForm((f) => ({ ...f, expectedCloseDate: e.target.value }))} />
          </div>
          <OwnerSelect value={form.owner} onChange={(owner) => setForm((f) => ({ ...f, owner }))} />
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || !form.title.trim() || !form.contact}>
            {pending ? "Saving…" : deal ? "Save changes" : "Create deal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
