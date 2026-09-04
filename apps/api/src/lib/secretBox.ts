import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../config/env";
import { logger } from "./logger";

/**
 * Encryption for third-party credentials at rest.
 *
 * Access tokens for a connected Instagram, Facebook page or TikTok account are
 * bearer credentials: anyone holding one can read and send on the customer's
 * behalf. A database dump must not hand them over in readable form, so they are
 * sealed here and only opened when a request is actually being made.
 *
 * AES-256-GCM rather than CBC because it authenticates as well as encrypts: a
 * tampered ciphertext fails to open instead of decrypting to rubbish that then
 * gets sent to Meta as a token.
 */

const VERSION = "v1";

/**
 * The key is derived from INTEGRATION_SECRET, falling back to JWT_SECRET so a
 * deployment that has not set one still encrypts rather than storing plaintext.
 * Deriving means any length of input yields the 32 bytes AES-256 needs.
 */
function key(): Buffer {
  const material = env.INTEGRATION_SECRET || env.JWT_SECRET;
  return createHash("sha256").update(`loom:integration:${material}`).digest();
}

/** True when the deployment is relying on the JWT secret rather than its own. */
export function usingFallbackSecret(): boolean {
  return !env.INTEGRATION_SECRET;
}

/**
 * Seals a secret. The output carries its version, nonce and auth tag, so the
 * format can change later without stranding rows written today.
 */
export function seal(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(".");
}

/**
 * Opens a sealed secret, or returns null.
 *
 * Null rather than a throw because the caller's right move is always the same:
 * mark the integration disconnected and ask the user to reconnect. A key that
 * changed, a corrupted row and a tampered row are indistinguishable here and
 * need the same response.
 */
export function open(sealed: string): string | null {
  try {
    const [version, iv, tag, data] = sealed.split(".");
    if (version !== VERSION || !iv || !tag || !data) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Shows enough of a token to recognise it, never enough to use it. */
export function fingerprint(plaintext: string): string {
  if (plaintext.length <= 8) return "…";
  return `${plaintext.slice(0, 4)}…${plaintext.slice(-4)}`;
}

/**
 * Constant-time comparison for webhook signatures.
 *
 * A normal string compare returns as soon as two bytes differ, and that timing
 * difference is enough to recover a signature byte by byte. Length is compared
 * first because timingSafeEqual throws on a mismatch.
 */
export function signatureMatches(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

if (usingFallbackSecret() && env.NODE_ENV === "production") {
  logger.warn("INTEGRATION_SECRET is not set: third-party tokens are encrypted with a key derived from JWT_SECRET. Rotating JWT_SECRET will invalidate stored connections.");
}
