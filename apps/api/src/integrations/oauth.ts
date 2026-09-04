import { randomBytes } from "node:crypto";
import type { IntegrationPlatform } from "@loom/shared";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { open, seal, signatureMatches } from "../lib/secretBox";
import { Integration } from "../models";

/**
 * OAuth for the connected platforms.
 *
 * The shape is the same everywhere: send the admin to the platform with a
 * signed state value, take back a short-lived code, exchange it server-side for
 * a token, and store that sealed. The client secret never reaches the browser
 * and the token never leaves the server.
 *
 * The state parameter is not decoration. Without it, anyone can send an admin a
 * crafted callback URL and bind the CRM to an account they control, which is
 * login CSRF with a third party's credentials attached.
 */

interface OAuthConfig {
  authorizeUrl: string;
  tokenUrl: string;
  clientId?: string;
  clientSecret?: string;
  scopes: string[];
}

const META_SCOPES = {
  facebook: ["pages_show_list", "pages_messaging", "pages_manage_metadata", "leads_retrieval", "business_management"],
  instagram: ["instagram_basic", "instagram_manage_messages", "pages_show_list", "pages_manage_metadata"],
};

function configFor(platform: IntegrationPlatform): OAuthConfig {
  switch (platform) {
    case "facebook":
      return {
        authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
        tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
        clientId: env.META_APP_ID,
        clientSecret: env.META_APP_SECRET,
        scopes: META_SCOPES.facebook,
      };
    case "instagram":
      return {
        authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
        tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
        clientId: env.META_APP_ID,
        clientSecret: env.META_APP_SECRET,
        scopes: META_SCOPES.instagram,
      };
    case "tiktok":
      return {
        authorizeUrl: "https://business-api.tiktok.com/portal/auth",
        tokenUrl: "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/",
        clientId: env.TIKTOK_APP_ID,
        clientSecret: env.TIKTOK_APP_SECRET,
        scopes: [],
      };
  }
}

export function isConfigured(platform: IntegrationPlatform): boolean {
  return missingCredentials(platform).length === 0;
}

/**
 * Which environment variables this platform is still waiting on.
 *
 * Named rather than counted, because "not configured" sends someone hunting
 * through a dashboard while "META_APP_ID is missing" does not. This is the
 * difference between a five-second fix and an afternoon.
 */
export function missingCredentials(platform: IntegrationPlatform): string[] {
  const c = configFor(platform);
  const prefix = platform === "tiktok" ? "TIKTOK" : "META";
  const missing: string[] = [];
  if (!c.clientId) missing.push(`${prefix}_APP_ID`);
  if (!c.clientSecret) missing.push(`${prefix}_APP_SECRET`);
  return missing;
}

/** Where the platform sends the admin back. Must match the app's registered redirect exactly. */
export function redirectUri(platform: IntegrationPlatform): string {
  const base = env.PUBLIC_API_URL || env.WEB_ORIGIN;
  return `${base.replace(/\/$/, "")}/api/integrations/${platform}/callback`;
}

/**
 * State is signed rather than stored.
 *
 * A server-side store would need cleaning up and would not survive a serverless
 * instance being recycled between the redirect and the callback. Sealing the
 * platform, the admin's id and a nonce into the value itself gives the same
 * guarantee without any state to keep.
 */
interface StatePayload {
  platform: IntegrationPlatform;
  userId: string;
  nonce: string;
  issuedAt: number;
}

const STATE_TTL_MS = 10 * 60_000;

export function createState(platform: IntegrationPlatform, userId: string): string {
  const payload: StatePayload = { platform, userId, nonce: randomBytes(12).toString("hex"), issuedAt: Date.now() };
  return encodeURIComponent(seal(JSON.stringify(payload)));
}

export function readState(raw: string): StatePayload | null {
  const opened = open(decodeURIComponent(raw));
  if (!opened) return null;
  try {
    const payload = JSON.parse(opened) as StatePayload;
    // An expired state is a stale tab or a replayed link, not a live consent.
    if (Date.now() - payload.issuedAt > STATE_TTL_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

export function authorizeUrl(platform: IntegrationPlatform, userId: string): string {
  const c = configFor(platform);
  if (!c.clientId) throw new Error(`${platform} is missing its client id.`);

  const state = createState(platform, userId);
  if (platform === "tiktok") {
    const url = new URL(c.authorizeUrl);
    url.searchParams.set("app_id", c.clientId);
    url.searchParams.set("redirect_uri", redirectUri(platform));
    url.searchParams.set("state", state);
    return url.toString();
  }

  const url = new URL(c.authorizeUrl);
  url.searchParams.set("client_id", c.clientId);
  url.searchParams.set("redirect_uri", redirectUri(platform));
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", c.scopes.join(","));
  return url.toString();
}

export interface TokenGrant {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  externalId?: string | null;
  externalName?: string | null;
}

async function exchangeMeta(platform: "instagram" | "facebook", code: string): Promise<TokenGrant> {
  const c = configFor(platform);
  const url = new URL(c.tokenUrl);
  url.searchParams.set("client_id", c.clientId!);
  url.searchParams.set("client_secret", c.clientSecret!);
  url.searchParams.set("redirect_uri", redirectUri(platform));
  url.searchParams.set("code", code);

  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: { message?: string } };
  if (!res.ok || !json.access_token) throw new Error(json.error?.message ?? `Token exchange failed (${res.status}).`);

  // The user token is short-lived and cannot post as a page. Exchanging it for a
  // long-lived token and then a page token is what makes the connection last
  // longer than an hour and able to read leads and send messages.
  const longLived = await exchangeForLongLived(platform, json.access_token).catch(() => null);
  const userToken = longLived?.token ?? json.access_token;
  const page = await firstPage(userToken).catch(() => null);

  return {
    accessToken: page?.accessToken ?? userToken,
    expiresAt: longLived?.expiresAt ?? (json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null),
    externalId: page?.id ?? null,
    externalName: page?.name ?? null,
  };
}

async function exchangeForLongLived(platform: "instagram" | "facebook", token: string) {
  const c = configFor(platform);
  const url = new URL(c.tokenUrl);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", c.clientId!);
  url.searchParams.set("client_secret", c.clientSecret!);
  url.searchParams.set("fb_exchange_token", token);

  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!res.ok || !json.access_token) return null;
  return {
    token: json.access_token,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null,
  };
}

/** The page the admin manages. Its token is what reads leads and sends messages. */
async function firstPage(userToken: string) {
  const res = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${encodeURIComponent(userToken)}`, {
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json()) as { data?: Array<{ id?: string; name?: string; access_token?: string }> };
  const page = json.data?.[0];
  if (!page?.id || !page.access_token) return null;
  return { id: page.id, name: page.name ?? null, accessToken: page.access_token };
}

async function exchangeTikTok(code: string): Promise<TokenGrant> {
  const c = configFor("tiktok");
  const res = await fetch(c.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: c.clientId, secret: c.clientSecret, auth_code: code, grant_type: "auth_code" }),
    signal: AbortSignal.timeout(20_000),
  });

  const json = (await res.json()) as {
    code?: number;
    message?: string;
    data?: { access_token?: string; refresh_token?: string; expires_in?: number; advertiser_ids?: string[] };
  };
  // TikTok answers 200 with an error code in the body, so the status is not enough.
  if (json.code && json.code !== 0) throw new Error(`TikTok: ${json.message ?? "token exchange failed"}`);
  if (!json.data?.access_token) throw new Error("TikTok returned no access token.");

  return {
    accessToken: json.data.access_token,
    refreshToken: json.data.refresh_token ?? null,
    expiresAt: json.data.expires_in ? new Date(Date.now() + json.data.expires_in * 1000) : null,
    externalId: json.data.advertiser_ids?.[0] ?? null,
  };
}

export async function exchangeCode(platform: IntegrationPlatform, code: string): Promise<TokenGrant> {
  if (platform === "tiktok") return exchangeTikTok(code);
  return exchangeMeta(platform, code);
}

/** Stores a grant. The same path the manual form used, so there is one way in. */
export async function saveGrant(platform: IntegrationPlatform, grant: TokenGrant, userId: string) {
  return Integration.findOneAndUpdate(
    { platform },
    {
      $set: {
        platform,
        accessToken: seal(grant.accessToken),
        refreshToken: grant.refreshToken ? seal(grant.refreshToken) : null,
        expiresAt: grant.expiresAt ?? null,
        externalId: grant.externalId ?? null,
        externalName: grant.externalName ?? null,
        status: "connected",
        lastError: null,
        connectedBy: userId,
      },
    },
    { new: true, upsert: true },
  );
}

/**
 * Refreshes tokens before they expire.
 *
 * Run as a scheduled job. A connection that lapses silently looks identical to
 * one that was never made, so a failure marks the integration in error with a
 * reason an admin can act on rather than leaving it to fail at the next message.
 */
const REFRESH_WINDOW_MS = 3 * 86_400_000;

export async function refreshExpiringTokens(): Promise<{ checked: number; refreshed: number; failed: number }> {
  const soon = new Date(Date.now() + REFRESH_WINDOW_MS);
  const rows = await Integration.find({ status: "connected", expiresAt: { $ne: null, $lte: soon } });

  let refreshed = 0;
  let failed = 0;

  for (const row of rows) {
    const platform = row.platform as IntegrationPlatform;
    try {
      if (platform === "tiktok") {
        // TikTok's business tokens are long-lived and not refreshable this way;
        // an expiring one needs the admin to reconnect.
        throw new Error("TikTok connections must be renewed by reconnecting.");
      }
      const token = open(row.accessToken);
      if (!token) throw new Error("Stored credential could not be decrypted.");
      const longLived = await exchangeForLongLived(platform, token);
      if (!longLived) throw new Error("The platform declined to extend this token.");
      row.accessToken = seal(longLived.token);
      row.expiresAt = longLived.expiresAt;
      row.lastError = null;
      refreshed += 1;
    } catch (err) {
      row.status = "error";
      row.lastError = `Could not refresh: ${err instanceof Error ? err.message : String(err)}. Reconnect the account.`;
      failed += 1;
    }
    await row.save();
  }

  if (rows.length > 0) logger.info({ checked: rows.length, refreshed, failed }, "Integration token refresh complete");
  return { checked: rows.length, refreshed, failed };
}

/** Guards the callback against a state value we did not issue. */
export function stateMatches(expected: string, received: string) {
  return signatureMatches(expected, received);
}
