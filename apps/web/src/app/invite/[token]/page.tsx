"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { PasswordField, passwordIsValid } from "@/components/password-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { useAcceptInvite, useInvitePreview } from "@/lib/hooks";

/** Where an invitation link lands. The invitee sets their own password here. */
export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { data, isLoading, isError, error: previewError } = useInvitePreview(token);
  const accept = useAcceptInvite(token);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.invite.name) setName(data.invite.name);
  }, [data]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await accept.mutateAsync({ name, password });
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-ground p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="gap-2">
          <div className="flex items-center gap-2 text-signal">
            <Sparkles className="size-5" />
            <span className="font-mono text-[11px] tracking-[0.14em] uppercase">LOOM</span>
          </div>
          {isError ? (
            <>
              <CardTitle className="font-display text-3xl">This link no longer works</CardTitle>
              <CardDescription>{errorMessage(previewError)}</CardDescription>
            </>
          ) : (
            <>
              <CardTitle className="font-display text-3xl">Join the team</CardTitle>
              <CardDescription>
                {data ? (
                  <>
                    {data.invite.invitedByName ? `${data.invite.invitedByName} invited you` : "You have been invited"} to join as{" "}
                    <Badge variant="outline" className="capitalize">
                      {data.invite.role}
                    </Badge>
                    . Choose a password to finish.
                  </>
                ) : (
                  "Checking your invitation…"
                )}
              </CardDescription>
            </>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex flex-col gap-4">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : isError ? (
            <Button asChild variant="outline" className="w-full">
              <Link href="/login">Go to sign in</Link>
            </Button>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={data?.invite.email ?? ""} readOnly disabled className="text-ink-3" />
                <p className="text-xs text-ink-3">The invitation is tied to this address.</p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Your name</Label>
                <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <PasswordField value={password} onChange={setPassword} />
              {error && <p className="text-sm text-bad">{error}</p>}
              <Button type="submit" disabled={accept.isPending || !name.trim() || !passwordIsValid(password)}>
                {accept.isPending ? "Setting up…" : "Create my account"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
