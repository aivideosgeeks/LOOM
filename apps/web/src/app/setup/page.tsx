"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { PasswordField, passwordIsValid } from "@/components/password-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { useSetup, useSetupState } from "@/lib/hooks";

/**
 * First run. Creates the administrator account for a brand new instance.
 * The server refuses this once any account exists, so it cannot be used later.
 */
export default function SetupPage() {
  const router = useRouter();
  const { data, isLoading } = useSetupState();
  const setup = useSetup();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data && !data.needsSetup) router.replace("/login");
  }, [data, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await setup.mutateAsync(form);
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const ready = form.name.trim() && form.email.trim() && passwordIsValid(form.password);

  return (
    <main className="flex min-h-screen items-center justify-center bg-ground p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="gap-2">
          <div className="flex items-center gap-2 text-signal">
            <Sparkles className="size-5" />
            <span className="font-mono text-[11px] tracking-[0.14em] uppercase">LOOM</span>
          </div>
          <CardTitle className="font-display text-3xl">Create your account</CardTitle>
          <CardDescription>
            This instance has no accounts yet. The first account is the administrator, and can invite everyone else.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex flex-col gap-4">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Your name</Label>
                <Input id="name" autoComplete="name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="username" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required />
              </div>
              <PasswordField value={form.password} onChange={(password) => setForm((f) => ({ ...f, password }))} />
              {error && <p className="text-sm text-bad">{error}</p>}
              <Button type="submit" disabled={setup.isPending || !ready}>
                {setup.isPending ? "Creating…" : "Create administrator account"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
