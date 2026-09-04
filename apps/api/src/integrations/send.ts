import type { IntegrationPlatform } from "@loom/shared";
import { PLATFORM_CAPABILITIES } from "@loom/shared";
import { logger } from "../lib/logger";
import { open } from "../lib/secretBox";
import { Integration } from "../models";

/**
 * Outbound messages.
 *
 * Meta's Send API is one shape for both Instagram and Facebook, differing only
 * in which page or account id the call is scoped to. TikTok has no messaging
 * API available at this tier at all, which is why the briefs put its inbox out
 * of scope, so it refuses rather than pretending.
 */

export type SendResult = { ok: true; externalId: string | null } | { ok: false; error: string };

const GRAPH = "https://graph.facebook.com/v21.0";

/** Rate limits are the expected failure here, so they are reported as themselves. */
function describeFailure(status: number, body: string): string {
  if (status === 429) return "Rate limited by the platform. The message was not sent; try again shortly.";
  if (status === 401 || status === 403) return "The stored access token was rejected. Reconnect the account.";
  return `Platform returned ${status}: ${body.slice(0, 200)}`;
}

export async function sendPlatformMessage(
  platform: IntegrationPlatform,
  recipientExternalId: string,
  text: string,
): Promise<SendResult> {
  if (!PLATFORM_CAPABILITIES[platform].messaging) {
    return { ok: false, error: `${PLATFORM_CAPABILITIES[platform].label} does not offer a messaging API at this access tier.` };
  }

  const integration = await Integration.findOne({ platform, status: "connected" });
  if (!integration) return { ok: false, error: `${platform} is not connected.` };

  const token = open(integration.accessToken);
  if (!token) {
    // The key changed or the row was tampered with. Either way the connection
    // is unusable and saying so beats sending an empty bearer token.
    integration.status = "error";
    integration.lastError = "Stored credential could not be decrypted. Reconnect the account.";
    await integration.save();
    return { ok: false, error: integration.lastError };
  }

  const url = `${GRAPH}/${integration.externalId ?? "me"}/messages`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ recipient: { id: recipientExternalId }, message: { text } }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const error = describeFailure(res.status, body);
      logger.warn({ platform, status: res.status }, "Outbound platform message failed");
      return { ok: false, error };
    }

    const json = (await res.json().catch(() => ({}))) as { message_id?: string };
    return { ok: true, externalId: json.message_id ?? null };
  } catch (err) {
    const error = err instanceof Error && err.name === "TimeoutError" ? "The platform did not respond in time." : `Could not reach the platform: ${err instanceof Error ? err.message : String(err)}`;
    logger.warn({ err, platform }, "Outbound platform message failed");
    return { ok: false, error };
  }
}
