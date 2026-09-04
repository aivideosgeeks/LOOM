"use client";

import { useState } from "react";
import type { IntegrationDTO, IntegrationPlatform } from "@loom/shared";
import { INTEGRATION_PLATFORMS, PLATFORM_CAPABILITIES } from "@loom/shared";
import { AlertTriangle, CheckCircle2, Link2, Plug, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAuthorizeIntegration,
  useConnectIntegration,
  useDisconnectIntegration,
  useIntegrations,
  useMe,
  useSyncLog,
  type PlatformCredentialState,
} from "@/lib/hooks";
import { timeAgo } from "@/lib/format";

const CAPABILITY_LABELS: Array<[keyof (typeof PLATFORM_CAPABILITIES)["instagram"], string]> = [
  ["messaging", "Two-way messaging"],
  ["leadForms", "Lead forms"],
  ["comments", "Comments"],
  ["pollingFallback", "Polling fallback"],
];

export default function IntegrationsPage() {
  const { data: me } = useMe();
  const isAdmin = me?.user.role === "admin";
  const { data, isLoading } = useIntegrations(isAdmin);
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const log = useSyncLog(platformFilter, isAdmin);

  if (!isAdmin) {
    return (
      <div className="enter-stack">
        <PageHeader title="Integrations" description="Administrators only." />
      </div>
    );
  }

  const byPlatform = new Map((data?.integrations ?? []).map((i) => [i.platform, i]));
  const summary = log.data?.summary ?? [];

  return (
    <div className="enter-stack space-y-6">
      <PageHeader
        title="Integrations"
        description="Connect a social account and its leads and messages flow into the CRM: contacts and deals are created, duplicates are checked against existing records, and every message is scored for sentiment and made searchable by meaning."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {INTEGRATION_PLATFORMS.map((platform) => (
          <PlatformCard
            key={platform}
            platform={platform}
            integration={byPlatform.get(platform)}
            credentials={(data?.credentials ?? []).find((c) => c.platform === platform)}
            summary={summary.find((s) => s.platform === platform)}
            loading={isLoading}
          />
        ))}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle>Sync log</CardTitle>
          <div className="flex items-center gap-2">
            <select
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              aria-label="Filter by platform"
              className="rounded-md border border-line bg-background px-2 py-1 text-sm"
            >
              <option value="all">All platforms</option>
              {INTEGRATION_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_CAPABILITIES[p].label}
                </option>
              ))}
            </select>
            <Button size="sm" variant="ghost" onClick={() => void log.refetch()} className="gap-1.5">
              <RefreshCw className={`size-3.5 ${log.isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {(log.data?.events ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-3">
              No events yet. They appear here as soon as a platform delivers a lead or a message.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Platform</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Arrived by</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {log.data!.events.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-sm">{PLATFORM_CAPABILITIES[e.platform].label}</TableCell>
                      <TableCell className="text-sm">{e.kind}</TableCell>
                      <TableCell>
                        {/* Which route carried it. On TikTok this is the answer to
                            whether the webhook subscription is doing anything. */}
                        <Badge variant={e.source === "webhook" ? "secondary" : "outline"}>{e.source}</Badge>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={e.status} error={e.error} attempts={e.attempts} />
                      </TableCell>
                      <TableCell className="text-sm text-ink-3">{timeAgo(e.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status, error, attempts }: { status: string; error: string | null; attempts: number }) {
  if (status === "processed") return <Badge className="bg-good-wash text-good">processed</Badge>;
  if (status === "failed")
    return (
      <span className="inline-flex items-center gap-1.5">
        <Badge variant="destructive">failed</Badge>
        <span className="text-xs text-ink-3" title={error ?? undefined}>
          retry {attempts}
        </span>
      </span>
    );
  if (status === "skipped")
    return (
      <span className="inline-flex items-center gap-1.5" title={error ?? undefined}>
        <Badge variant="outline">given up</Badge>
      </span>
    );
  return <Badge variant="outline">{status}</Badge>;
}

function PlatformCard({
  platform,
  integration,
  credentials,
  summary,
  loading,
}: {
  platform: IntegrationPlatform;
  integration?: IntegrationDTO;
  credentials?: PlatformCredentialState;
  summary?: { processed: number; failed: number; viaWebhook: number; viaPolling: number };
  loading: boolean;
}) {
  const caps = PLATFORM_CAPABILITIES[platform];
  const connect = useConnectIntegration();
  const authorize = useAuthorizeIntegration();
  const qc = useQueryClient();
  const disconnect = useDisconnectIntegration();
  const [token, setToken] = useState("");
  const [externalId, setExternalId] = useState("");
  const [open, setOpen] = useState(false);

  /**
   * Opens the platform's consent screen in a popup.
   *
   * A popup rather than a redirect so the admin does not lose this page, and the
   * callback posts its result back rather than the opener polling for it.
   */
  const beginOAuth = async () => {
    try {
      const { url } = await authorize.mutateAsync(platform);
      const popup = window.open(url, `loom-oauth-${platform}`, "width=640,height=760");
      if (!popup) {
        toast.error("Your browser blocked the popup. Allow popups for this site and try again.");
        return;
      }
      const onMessage = (e: MessageEvent) => {
        const data = e.data as { source?: string; platform?: string; ok?: boolean } | null;
        if (data?.source !== "loom-oauth" || data.platform !== platform) return;
        window.removeEventListener("message", onMessage);
        if (data.ok) {
          toast.success(`${caps.label} connected`);
          void qc.invalidateQueries({ queryKey: ["integrations"] });
        } else {
          toast.error(`${caps.label} was not connected`);
        }
      };
      window.addEventListener("message", onMessage);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const submit = async () => {
    try {
      await connect.mutateAsync({ platform, accessToken: token.trim(), externalId: externalId.trim() || undefined });
      setToken("");
      setExternalId("");
      setOpen(false);
      toast.success(`${caps.label} connected`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const remove = async () => {
    try {
      await disconnect.mutateAsync(platform);
      toast.success(`${caps.label} disconnected`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Card className="lift">
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{caps.label}</CardTitle>
          {integration ? (
            integration.status === "connected" ? (
              <Badge className="gap-1 bg-good-wash text-good">
                <CheckCircle2 className="size-3" /> Connected
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="size-3" /> {integration.status}
              </Badge>
            )
          ) : (
            <Badge variant="outline">Not connected</Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {CAPABILITY_LABELS.filter(([key]) => caps[key]).map(([, label]) => (
            <Badge key={label} variant="outline" className="text-[10px]">
              {label}
            </Badge>
          ))}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {loading && <p className="text-sm text-ink-3">Loading…</p>}

        {integration && (
          <dl className="space-y-1 text-sm">
            {integration.externalName && (
              <div className="flex justify-between gap-2">
                <dt className="text-ink-3">Account</dt>
                <dd>{integration.externalName}</dd>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <dt className="text-ink-3">Token</dt>
              <dd className="font-mono text-xs">{integration.tokenFingerprint ?? "unreadable"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-3">Webhook</dt>
              <dd>{integration.webhookActive ? "active" : caps.pollingFallback ? "polling" : "not verified"}</dd>
            </div>
            {integration.lastPolledAt && (
              <div className="flex justify-between gap-2">
                <dt className="text-ink-3">Last poll</dt>
                <dd>{timeAgo(integration.lastPolledAt)}</dd>
              </div>
            )}
            {summary && (
              <div className="flex justify-between gap-2">
                <dt className="text-ink-3">Events</dt>
                <dd>
                  {summary.processed} processed
                  {summary.failed > 0 && <span className="text-bad"> · {summary.failed} failed</span>}
                </dd>
              </div>
            )}
          </dl>
        )}

        {integration?.lastError && (
          <p className="rounded-md border border-bad/40 bg-bad-wash px-3 py-2 text-xs text-bad">{integration.lastError}</p>
        )}

        {credentials && !credentials.configured && (
          <div className="space-y-1.5 rounded-md border border-line bg-background px-3 py-2.5">
            <p className="text-xs font-medium">Not configured on the server</p>
            <p className="text-xs text-ink-3">
              Set {credentials.missing.join(" and ")} on the API for Production, then redeploy it.
            </p>
          </div>
        )}

        {!open && (
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => void beginOAuth()}
              disabled={authorize.isPending || credentials?.configured === false}
              className="gap-1.5"
            >
              <Plug className="size-3.5" /> {authorize.isPending ? "Opening…" : integration ? "Reconnect" : `Connect ${caps.label}`}
            </Button>
            {integration && (
              <Button size="sm" variant="ghost" onClick={() => void remove()} disabled={disconnect.isPending} className="gap-1.5 text-ink-3">
                <Unplug className="size-3.5" /> Disconnect
              </Button>
            )}
          </div>
        )}

        {open ? (
          <div className="space-y-2">
            <div className="space-y-1">
              <Label htmlFor={`${platform}-token`}>Access token</Label>
              <Input
                id={`${platform}-token`}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste the page or advertiser access token"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${platform}-id`}>{platform === "tiktok" ? "Advertiser ID" : "Page / account ID"}</Label>
              <Input id={`${platform}-id`} value={externalId} onChange={(e) => setExternalId(e.target.value)} autoComplete="off" />
            </div>
            <p className="text-xs text-ink-3">
              Stored encrypted and never shown again. The OAuth redirect needs a reviewed app on {caps.label}; until
              then a token pasted here drives the same pipeline.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void submit()} disabled={token.trim().length < 10 || connect.isPending}>
                {connect.isPending ? "Connecting…" : "Connect"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className="text-left text-xs text-ink-3 underline underline-offset-2">
            Paste a token instead
          </button>
        )}

        <p className="flex items-start gap-1.5 border-t border-line pt-3 text-xs text-ink-3">
          <Link2 className="mt-0.5 size-3 shrink-0" />
          Webhook URL: <code className="font-mono">/api/webhooks/{platform}</code>
        </p>
      </CardContent>
    </Card>
  );
}
