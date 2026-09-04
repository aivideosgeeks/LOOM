import { Router, type Request } from "express";
import { INTEGRATION_PLATFORMS, type IntegrationPlatform } from "@loom/shared";
import { env } from "../config/env";
import { ADAPTERS } from "../integrations/adapters";
import { ingestLead, ingestMessage, processOnce } from "../integrations/ingest";
import { signatureMatches } from "../lib/secretBox";
import { logger } from "../lib/logger";

export const webhooksRouter = Router();

function platformOf(req: Request): IntegrationPlatform | null {
  const raw = String(req.params.platform ?? "");
  return (INTEGRATION_PLATFORMS as readonly string[]).includes(raw) ? (raw as IntegrationPlatform) : null;
}

/**
 * Meta's subscription handshake.
 *
 * Meta calls this once when a webhook is registered and expects the challenge
 * echoed back verbatim, as plain text, only when the verify token matches.
 */
webhooksRouter.get("/:platform", (req, res) => {
  const platform = platformOf(req);
  if (!platform) return res.status(404).json({ error: "Unknown platform" });

  const mode = String(req.query["hub.mode"] ?? "");
  const token = String(req.query["hub.verify_token"] ?? "");
  const challenge = String(req.query["hub.challenge"] ?? "");

  if (mode !== "subscribe" || !env.META_VERIFY_TOKEN || !signatureMatches(env.META_VERIFY_TOKEN, token)) {
    logger.warn({ platform, mode }, "Rejected webhook verification handshake");
    return res.sendStatus(403);
  }
  logger.info({ platform }, "Webhook subscription verified");
  return res.type("text/plain").send(challenge);
});

/**
 * Inbound platform events.
 *
 * Two rules govern the response. An unverified request is refused before
 * anything is read, because this endpoint writes to the CRM and is public. And
 * once a request is verified, it is answered 200 even if individual events
 * failed: the platforms retry the whole delivery on any other status, which
 * would replay the events that already succeeded. Failures are recorded in the
 * sync log and retried from there instead.
 */
webhooksRouter.post("/:platform", async (req, res) => {
  const platform = platformOf(req);
  if (!platform) return res.status(404).json({ error: "Unknown platform" });

  const adapter = ADAPTERS[platform];
  const raw = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));

  if (!adapter.verify(raw, req.headers)) {
    logger.warn({ platform }, "Rejected webhook with an invalid signature");
    return res.sendStatus(401);
  }

  const events = adapter.parse(req.body);
  // Answer before the work where possible: Meta expects a fast 200 and resends
  // after roughly twenty seconds, which would duplicate deliveries under load.
  res.sendStatus(200);

  for (const event of events) {
    await processOnce(
      { platform, eventId: event.eventId, kind: event.kind, source: "webhook", payload: req.body },
      async () => {
        if (event.lead) return ingestLead(event.lead);
        if (event.message) return ingestMessage(event.message);
        throw new Error("Event carried neither a message nor a lead");
      },
    );
  }
});
