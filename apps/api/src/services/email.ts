import { env } from "../config/env";
import { logger } from "../lib/logger";

export interface OutgoingEmail {
  to: string;
  subject: string;
  body: string;
}

export interface EmailResult {
  sent: boolean;
  detail: string;
}

/**
 * Outbound email.
 *
 * Without SMTP_URL the CRM does not pretend: invitations show their link on
 * screen to be passed on by hand, and a drafted email is logged to the timeline
 * for the user to send from their own client. That is a working product, just a
 * manual one, and it is better than a queue of mail nobody receives.
 *
 * The transport is created once and reused. Building one per message opens a
 * fresh TLS connection every time, which most providers rate-limit.
 */
let transportPromise: Promise<{ sendMail(opts: Record<string, unknown>): Promise<unknown> } | null> | null = null;

function transport() {
  if (!env.SMTP_URL) return Promise.resolve(null);
  transportPromise ??= (async () => {
    const nodemailer = await import("nodemailer");
    const t = nodemailer.createTransport(env.SMTP_URL!);
    try {
      // Fail loudly at startup rather than silently at the first invitation.
      await t.verify();
      logger.info("SMTP transport verified");
    } catch (err) {
      logger.error({ err }, "SMTP credentials were rejected. Email will fall back to on-screen links.");
      return null;
    }
    return t as unknown as { sendMail(opts: Record<string, unknown>): Promise<unknown> };
  })();
  return transportPromise;
}

export function emailConfigured(): boolean {
  return Boolean(env.SMTP_URL);
}

/** Never throws. A failed send is reported so the caller can offer the manual path instead. */
export async function sendEmail(mail: OutgoingEmail): Promise<EmailResult> {
  if (!env.SMTP_URL) return { sent: false, detail: "SMTP is not configured; the link is shown on screen instead." };

  try {
    const t = await transport();
    if (!t) return { sent: false, detail: "SMTP is configured but was rejected; check the credentials." };

    await t.sendMail({
      from: env.SMTP_FROM,
      to: mail.to,
      subject: mail.subject,
      text: mail.body,
      // A plain-text alternative alongside a simple HTML body: some clients hide
      // bare URLs in text/plain, which is how an invitation link goes missing.
      html: htmlBody(mail.body),
    });
    return { sent: true, detail: "Sent." };
  } catch (err) {
    logger.error({ err, to: mail.to }, "SMTP send failed");
    return { sent: false, detail: `Could not send: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Escapes the text and turns bare URLs into links; no templating engine needed for this. */
function htmlBody(text: string): string {
  const escaped = text.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
  const linked = escaped.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>');
  return `<div style="font:15px/1.6 system-ui,sans-serif;color:#1a1a1a">${linked.replace(/\n/g, "<br>")}</div>`;
}

/** Test hook: drops the cached transport so a changed configuration is picked up. */
export function resetEmailTransport() {
  transportPromise = null;
}
