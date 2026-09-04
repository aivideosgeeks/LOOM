import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// The env module parses process.env once at import, so setting variables in a
// hook would be too late for the adapters that already read it. hoisted runs
// before the mock factory, which runs before the imports below.
const secrets = vi.hoisted(() => ({ META_APP_SECRET: "test-meta-app-secret", TIKTOK_APP_SECRET: "test-tiktok-secret" }));

vi.mock("../config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/env")>();
  return { ...actual, env: { ...actual.env, ...secrets } };
});

import { fingerprint, open, seal, signatureMatches } from "../lib/secretBox";
import { facebookAdapter, instagramAdapter, tiktokAdapter } from "../integrations/adapters";
import { guessField } from "../integrations/ingest";

const APP_SECRET = secrets.META_APP_SECRET;

function metaSign(body: string) {
  return `sha256=${createHmac("sha256", APP_SECRET).update(body).digest("hex")}`;
}

describe("credential storage", () => {
  it("round-trips a token", () => {
    const token = "EAAG-not-a-real-token-0123456789";
    expect(open(seal(token))).toBe(token);
  });

  it("produces different ciphertext each time, so equal tokens are not recognisable", () => {
    expect(seal("same-token")).not.toBe(seal("same-token"));
  });

  it("refuses to open tampered ciphertext rather than returning rubbish", () => {
    const sealed = seal("sensitive-token");
    const parts = sealed.split(".");
    // Flip a byte of the payload; GCM's tag should catch it.
    const flipped = Buffer.from(parts[3]!, "base64url");
    flipped[0] ^= 0xff;
    parts[3] = flipped.toString("base64url");
    expect(open(parts.join("."))).toBeNull();
  });

  it("returns null for junk instead of throwing", () => {
    for (const bad of ["", "not-sealed", "v1.a.b.c", "v2.a.b.c"]) expect(open(bad)).toBeNull();
  });

  it("never reveals the middle of a token in a fingerprint", () => {
    const token = "EAAGsecretmiddlepartXYZ";
    const fp = fingerprint(token);
    expect(fp).toContain("EAAG");
    expect(fp).not.toContain("secretmiddlepart");
  });

  it("compares signatures without leaking length-independent timing", () => {
    expect(signatureMatches("abc", "abc")).toBe(true);
    expect(signatureMatches("abc", "abd")).toBe(false);
    expect(signatureMatches("abc", "abcd")).toBe(false);
  });
});

describe("webhook signature verification", () => {
  const body = JSON.stringify({ entry: [{ messaging: [] }] });

  it("accepts a correctly signed Meta delivery", () => {
    const raw = Buffer.from(body);
    expect(instagramAdapter.verify(raw, { "x-hub-signature-256": metaSign(body) })).toBe(true);
    expect(facebookAdapter.verify(raw, { "x-hub-signature-256": metaSign(body) })).toBe(true);
  });

  it("rejects a wrong signature, a missing header, and a tampered body", () => {
    const raw = Buffer.from(body);
    expect(instagramAdapter.verify(raw, { "x-hub-signature-256": "sha256=deadbeef" })).toBe(false);
    expect(instagramAdapter.verify(raw, {})).toBe(false);
    // Signature computed over different bytes than were delivered.
    expect(instagramAdapter.verify(Buffer.from(body + " "), { "x-hub-signature-256": metaSign(body) })).toBe(false);
  });

  it("verifies TikTok's timestamped signature scheme", () => {
    const payload = JSON.stringify({ event: "lead", data: { lead_id: "1" } });
    const t = "1788000000";
    const s = createHmac("sha256", "test-tiktok-secret").update(`${t}.${payload}`).digest("hex");
    expect(tiktokAdapter.verify(Buffer.from(payload), { "tiktok-signature": `t=${t}, s=${s}` })).toBe(true);
    expect(tiktokAdapter.verify(Buffer.from(payload), { "tiktok-signature": `t=${t}, s=wrong` })).toBe(false);
    expect(tiktokAdapter.verify(Buffer.from(payload), {})).toBe(false);
  });
});

describe("payload normalisation", () => {
  it("reads a Messenger message", () => {
    const events = facebookAdapter.parse({
      entry: [
        {
          messaging: [
            { sender: { id: "u1" }, timestamp: 1788000000000, message: { mid: "m1", text: "Do you offer annual billing?" } },
          ],
        },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventId: "m1", kind: "message" });
    expect(events[0]!.message).toMatchObject({ senderExternalId: "u1", text: "Do you offer annual billing?" });
  });

  it("ignores echoes, so our own replies are not filed as the customer's", () => {
    const events = facebookAdapter.parse({
      entry: [{ messaging: [{ sender: { id: "page" }, message: { mid: "m2", text: "Thanks!", is_echo: true } }] }],
    });
    expect(events).toEqual([]);
  });

  it("skips messages with no text, such as a bare sticker", () => {
    const events = instagramAdapter.parse({ entry: [{ messaging: [{ sender: { id: "u1" }, message: { mid: "m3" } }] }] });
    expect(events).toEqual([]);
  });

  it("reads a lead form submission with its answers", () => {
    const events = facebookAdapter.parse({
      entry: [
        {
          changes: [
            {
              field: "leadgen",
              value: {
                leadgen_id: "L1",
                form_id: "F1",
                form_name: "Spring campaign",
                created_time: 1788000000,
                field_data: [
                  { name: "email", values: ["sam@kestrel.io"] },
                  { name: "what_are_you_looking_for", values: ["Pricing for 40 seats"] },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.lead).toMatchObject({
      externalLeadId: "L1",
      formId: "F1",
      fields: { email: "sam@kestrel.io", what_are_you_looking_for: "Pricing for 40 seats" },
    });
  });

  it("reads a TikTok lead", () => {
    const events = tiktokAdapter.parse({
      event: "lead_submit",
      data: { lead_id: "T1", form_id: "TF1", create_time: 1788000000, field_data: [{ name: "phone", values: ["+1 555 0100"] }] },
    });
    expect(events[0]).toMatchObject({ eventId: "tiktok-lead:T1", kind: "lead" });
    expect(events[0]!.lead!.fields).toEqual({ phone: "+1 555 0100" });
  });

  it("produces the same event id from the webhook and polling paths, so one lead is one contact", () => {
    const viaWebhook = tiktokAdapter.parse({ data: { lead_id: "T9" } })[0]!.eventId;
    // poll.ts builds its id with the same rule; this locks the two together.
    expect(viaWebhook).toBe("tiktok-lead:T9");
  });

  it("returns nothing for a delivery it does not understand", () => {
    expect(facebookAdapter.parse({})).toEqual([]);
    expect(tiktokAdapter.parse({ data: {} })).toEqual([]);
  });
});

describe("lead field guessing", () => {
  it("recognises the standard questions across naming styles", () => {
    expect(guessField("email")).toBe("email");
    expect(guessField("EMAIL_ADDRESS")).toBe("email");
    expect(guessField("phone_number")).toBe("phone");
    expect(guessField("mobile")).toBe("phone");
    expect(guessField("company_name")).toBe("company");
    expect(guessField("full_name")).toBe("name");
  });

  it("returns null for anything else, so the answer is kept as a note rather than guessed", () => {
    expect(guessField("what_are_you_looking_for")).toBeNull();
    expect(guessField("budget_range")).toBeNull();
  });
});
