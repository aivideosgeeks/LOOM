import { env } from "../config/env";
import { logger } from "../lib/logger";

export interface OutgoingEmail {
  to: string;
  subject: string;
  body: string;
}

/**
 * Sends through SMTP when SMTP_URL is configured. Otherwise the email is only logged to the
 * timeline and the UI offers a mail-client hand-off. The AI never calls this.
 */
export async function sendEmail(mail: OutgoingEmail): Promise<{ sent: boolean; detail: string }> {
  if (!env.SMTP_URL) return { sent: false, detail: "SMTP not configured; email logged only." };
  try {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport(env.SMTP_URL);
    await transport.sendMail({ from: env.SMTP_FROM, to: mail.to, subject: mail.subject, text: mail.body });
    return { sent: true, detail: "Sent via SMTP." };
  } catch (err) {
    logger.error({ err }, "SMTP send failed");
    return { sent: false, detail: `SMTP send failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
