"use client";

import { useState } from "react";
import type { Role } from "@loom/shared";
import { ROLES } from "@loom/shared";
import { Check, Copy, Link2, Mail, MailX, RefreshCw, Send, ShieldOff, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage } from "@/lib/api";
import { useChangeRole, useCreateInvite, useInvites, useMe, useRemoveUser, useResendInvite, useRevokeInvite, useUsers } from "@/lib/hooks";
import { formatDate, initials, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={() => {
        void navigator.clipboard.writeText(link).then(() => {
          setCopied(true);
          toast.success("Invitation link copied");
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? <Check className="size-3.5 text-good" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

export default function TeamPage() {
  const { data: me } = useMe();
  const users = useUsers();
  const invites = useInvites();
  const createInvite = useCreateInvite();
  const resend = useResendInvite();
  const revoke = useRevokeInvite();
  const changeRole = useChangeRole();
  const removeUser = useRemoveUser();

  const [form, setForm] = useState<{ email: string; name: string; role: Role }>({ email: "", name: "", role: "member" });
  const [lastLink, setLastLink] = useState<{ email: string; link: string; emailed: boolean; detail?: string } | null>(null);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await createInvite.mutateAsync({ email: form.email.trim(), role: form.role, name: form.name.trim() || undefined });
      setLastLink({ email: res.invite.email, link: res.invite.link ?? "", emailed: !!res.invite.emailed, detail: res.invite.emailDetail });
      setForm({ email: "", name: "", role: "member" });
      toast.success(res.invite.emailed ? `Invitation emailed to ${res.invite.email}` : "Invitation created. Send them the link.");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const isAdmin = me?.user.role === "admin";
  const loading = users.isLoading || invites.isLoading;

  // The API refuses members anyway; say so plainly rather than rendering an empty shell.
  if (me && !isAdmin) {
    return (
      <div className="enter-stack mx-auto flex max-w-2xl flex-col gap-6">
        <PageHeader eyebrow="Admin" title="Team" />
        <EmptyState
          icon={ShieldOff}
          title="Administrators only"
          description="Managing accounts and invitations needs an administrator. Ask one of yours if you need someone added."
        />
      </div>
    );
  }

  return (
    <div className="enter-stack mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        eyebrow="Admin"
        title="Team"
        description="Everyone with an account, and the invitations still outstanding. There is no public sign-up: people join by invitation only."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="size-4 text-ink-3" /> Invite someone
          </CardTitle>
          <CardDescription>
            They receive a one-time link to choose their own password. It expires in seven days, and issuing a new one for the same address cancels the old link.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form onSubmit={invite} className="grid gap-3 sm:grid-cols-[1fr_1fr_9rem_auto]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" type="email" required placeholder="person@company.com" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-name">Name (optional)</Label>
              <Input id="invite-name" placeholder="So the invitation is personal" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(role) => setForm((f) => ({ ...f, role: role as Role }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r} className="capitalize">
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="submit" className="gap-2" disabled={createInvite.isPending || !form.email.trim()}>
                <Send className="size-4" /> {createInvite.isPending ? "Sending…" : "Send invite"}
              </Button>
            </div>
          </form>

          {lastLink && (
            <div className={cn("flex flex-col gap-2 rounded-lg border p-3", lastLink.emailed ? "border-good/30 bg-good-wash" : "border-caution/35 bg-caution-wash")}>
              <p className="flex items-center gap-2 text-sm font-medium">
                {lastLink.emailed ? <Mail className="size-4 text-good" /> : <MailX className="size-4 text-caution" />}
                {lastLink.emailed ? `Emailed to ${lastLink.email}` : `No email server configured, so send this link to ${lastLink.email} yourself`}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto rounded bg-paper/70 px-2 py-1 font-mono text-xs whitespace-nowrap">{lastLink.link}</code>
                <CopyLink link={lastLink.link} />
              </div>
              <p className="text-xs text-ink-3">This link is shown once. If you lose it, use Resend on the invitation below to issue a fresh one.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {loading ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          {(invites.data?.invites.length ?? 0) > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Pending invitations ({invites.data!.invites.length})</CardTitle>
                <CardDescription>Nobody in this list has an account yet.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Invited by</TableHead>
                        <TableHead>Expires</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invites.data!.invites.map((i) => (
                        <TableRow key={i.id} className="row-hover">
                          <TableCell>
                            <span className="font-medium">{i.email}</span>
                            {i.name && <p className="text-xs text-ink-3">{i.name}</p>}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">
                              {i.role}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-ink-3">{i.invitedBy?.name ?? "-"}</TableCell>
                          <TableCell className="text-sm">
                            {i.expired ? <span className="text-bad">Expired</span> : <span className="text-ink-3">{formatDate(i.expiresAt)}</span>}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5"
                                disabled={resend.isPending}
                                onClick={() =>
                                  resend
                                    .mutateAsync(i.id)
                                    .then((r) => {
                                      setLastLink({ email: r.invite.email, link: r.invite.link ?? "", emailed: !!r.invite.emailed, detail: r.invite.emailDetail });
                                      toast.success(r.invite.emailed ? "Invitation resent" : "New link created");
                                    })
                                    .catch((e) => toast.error(errorMessage(e)))
                                }
                              >
                                <RefreshCw className="size-3.5" /> Resend
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Revoke the invitation for ${i.email}`}
                                disabled={revoke.isPending}
                                onClick={() => {
                                  if (!window.confirm(`Revoke the invitation for ${i.email}? Their link stops working immediately.`)) return;
                                  revoke.mutateAsync(i.id).then(() => toast.success("Invitation revoked")).catch((e) => toast.error(errorMessage(e)));
                                }}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>People ({users.data?.users.length ?? 0})</CardTitle>
              <CardDescription>Administrators see every record and can manage the team. Members only ever see what they own.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.data?.users.map((u) => {
                      const isMe = u.id === me?.user.id;
                      return (
                        <TableRow key={u.id} className="row-hover">
                          <TableCell>
                            <span className="flex items-center gap-2.5">
                              <span className="flex size-7 items-center justify-center rounded-full bg-signal-wash text-xs font-semibold text-signal">{initials(u.name)}</span>
                              <span className="font-medium">{u.name}</span>
                              {isMe && <span className="font-mono text-[10px] tracking-wide text-ink-3 uppercase">you</span>}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm text-ink-3">{u.email}</TableCell>
                          <TableCell>
                            <Select
                              value={u.role}
                              onValueChange={(role) =>
                                changeRole
                                  .mutateAsync({ id: u.id, role: role as Role })
                                  .then(() => toast.success(`${u.name} is now ${role === "admin" ? "an administrator" : "a member"}`))
                                  .catch((e) => toast.error(errorMessage(e)))
                              }
                            >
                              <SelectTrigger size="sm" className="w-32 capitalize">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ROLES.map((r) => (
                                  <SelectItem key={r} value={r} className="capitalize">
                                    {r}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end">
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Remove ${u.name}`}
                                disabled={isMe || removeUser.isPending}
                                title={isMe ? "You cannot remove your own account" : undefined}
                                onClick={() => {
                                  if (!window.confirm(`Remove ${u.name}? This only works if they no longer own any records.`)) return;
                                  removeUser.mutateAsync(u.id).then(() => toast.success(`${u.name} removed`)).catch((e) => toast.error(errorMessage(e)));
                                }}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-3">
                <Link2 className="size-3" />
                Removing someone is refused while they still own contacts or deals. Reassign their records first, so nothing is orphaned.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
