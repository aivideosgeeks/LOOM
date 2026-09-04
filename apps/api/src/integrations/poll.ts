import type { IntegrationPlatform } from "@loom/shared";
import { PLATFORM_CAPABILITIES } from "@loom/shared";
import { logger } from "../lib/logger";
import { open } from "../lib/secretBox";
import { Integration, WebhookEvent } from "../models";
import { ingestLead, ingestMessage, processOnce } from "./ingest";

/**
 * The polling fallback.
 *
 * TikTok's webhook access tier is inconsistent, so the brief is explicit that
 * polling must exist whether or not the subscription succeeds. It runs for any
 * platform whose capabilities declare it, and it is not a lesser path: it goes
 * through the same idempotency check and the same ingestion pipeline, so a lead
 * that arrives by both routes still produces one contact. The only difference
 * is the `source` recorded in the sync log, which is what tells an admin
 * whether webhooks are actually delivering.
 */

const LOOKBACK_MS = 60 * 60_000;

/** A platform 429 means back off, not retry immediately; the next run picks it up. */
function isRateLimited(status: number) {
  return status === 429;
}

interface TikTokLeadRow {
  lead_id?: string;
  form_id?: string;
  form_name?: string;
  create_time?: number;
  field_data?: Array<{ name?: string; values?: string[] }>;
}

async function fetchTikTokLeads(token: string, advertiserId: string, since: Date): Promise<TikTokLeadRow[]> {
  const url = new URL("https://business-api.tiktok.com/open_api/v1.3/pages/leads/task/");
  url.searchParams.set("advertiser_id", advertiserId);
  url.searchParams.set("start_time", String(Math.floor(since.getTime() / 1000)));

  const res = await fetch(url, {
    headers: { "Access-Token": token, "content-type": "application/json" },
    signal: AbortSignal.timeout(20_000),
  });

  if (isRateLimited(res.status)) throw new Error("Rate limited by TikTok; will retry on the next run.");
  if (!res.ok) throw new Error(`TikTok returned ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);

  const json = (await res.json()) as { code?: number; message?: string; data?: { list?: TikTokLeadRow[] } };
  // TikTok answers 200 with an error code in the body, so the status alone is
  // not enough to know the call worked.
  if (json.code && json.code !== 0) throw new Error(`TikTok error ${json.code}: ${json.message ?? "unknown"}`);
  return json.data?.list ?? [];
}

/** Polls one platform and ingests anything new. Returns what it found, for the log. */
export async function pollPlatform(platform: IntegrationPlatform): Promise<{ found: number; ingested: number; duplicates: number }> {
  const integration = await Integration.findOne({ platform, status: "connected" });
  if (!integration) return { found: 0, ingested: 0, duplicates: 0 };

  const token = open(integration.accessToken);
  if (!token) {
    integration.status = "error";
    integration.lastError = "Stored credential could not be decrypted. Reconnect the account.";
    await integration.save();
    return { found: 0, ingested: 0, duplicates: 0 };
  }

  const since = integration.lastPolledAt ?? new Date(Date.now() - LOOKBACK_MS);
  let rows: TikTokLeadRow[] = [];

  try {
    if (platform === "tiktok") {
      rows = await fetchTikTokLeads(token, integration.externalId ?? "", since);
    }
    integration.lastError = null;
  } catch (err) {
    // A failed poll is recorded and left for the next run rather than retried
    // in a tight loop, which is what a rate limit is asking for.
    integration.lastError = err instanceof Error ? err.message : String(err);
    await integration.save();
    logger.warn({ err, platform }, "Polling failed");
    return { found: 0, ingested: 0, duplicates: 0 };
  }

  let ingested = 0;
  let duplicates = 0;

  for (const row of rows) {
    if (!row.lead_id) continue;
    const result = await processOnce(
      { platform, eventId: `tiktok-lead:${row.lead_id}`, kind: "lead", source: "polling", payload: row },
      () =>
        ingestLead({
          platform,
          externalLeadId: row.lead_id!,
          formId: row.form_id ?? "unknown",
          formName: row.form_name ?? null,
          fields: Object.fromEntries((row.field_data ?? []).map((f) => [f.name ?? "", f.values?.[0] ?? ""])),
          createdAt: row.create_time ? new Date(row.create_time * 1000) : new Date(),
        }),
    );
    if (result.status === "processed") ingested += 1;
    if (result.status === "duplicate") duplicates += 1;
  }

  integration.lastPolledAt = new Date();
  await integration.save();

  logger.info({ platform, found: rows.length, ingested, duplicates }, "Polling run complete");
  return { found: rows.length, ingested, duplicates };
}

/** Polls every connected platform that needs it. */
export async function pollAllPlatforms(): Promise<void> {
  const connected = await Integration.find({ status: "connected" }).select("platform").lean();
  for (const row of connected) {
    const platform = row.platform as IntegrationPlatform;
    if (!PLATFORM_CAPABILITIES[platform]?.pollingFallback) continue;
    await pollPlatform(platform);
  }
}

/**
 * Retries events that failed to process.
 *
 * The webhook route answers 200 even when an event fails, because any other
 * status makes the platform resend the whole delivery and replay the events
 * that already worked. That trade is only sound if something else retries the
 * failures, which is this.
 */
const MAX_ATTEMPTS = 5;

export async function retryFailedEvents(): Promise<{ retried: number; recovered: number }> {
  const failed = await WebhookEvent.find({ status: "failed", attempts: { $lt: MAX_ATTEMPTS } })
    .sort({ createdAt: 1 })
    .limit(50);

  let recovered = 0;
  for (const event of failed) {
    event.attempts += 1;
    try {
      const payload = event.payload as Record<string, unknown>;
      if (event.kind === "lead") {
        await ingestLead(payload as never);
      } else {
        await ingestMessage(payload as never);
      }
      event.status = "processed";
      event.processedAt = new Date();
      event.error = null;
      recovered += 1;
    } catch (err) {
      event.error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      // Giving up is recorded as such, so the sync log distinguishes "still
      // trying" from "will never succeed without someone looking at it".
      if (event.attempts >= MAX_ATTEMPTS) event.status = "skipped";
    }
    await event.save();
  }

  if (failed.length > 0) logger.info({ retried: failed.length, recovered }, "Retried failed platform events");
  return { retried: failed.length, recovered };
}
