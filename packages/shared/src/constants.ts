export const PIPELINE_STAGES = ["Lead", "Contacted", "Proposal", "Negotiation", "Won", "Lost"] as const;
export type Stage = (typeof PIPELINE_STAGES)[number];

export const OPEN_STAGES: readonly Stage[] = ["Lead", "Contacted", "Proposal", "Negotiation"];
export const CLOSED_STAGES: readonly Stage[] = ["Won", "Lost"];

export const ROLES = ["admin", "member"] as const;
export type Role = (typeof ROLES)[number];

export const NOTE_KINDS = ["note", "call", "email", "meeting", "system"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

/** Note kinds that count as a human touch (engagement) for scoring. */
export const ENGAGEMENT_KINDS: readonly NoteKind[] = ["note", "call", "email", "meeting"];

export const AI_FEATURES = [
  "lead_scoring",
  "sentiment",
  "email_draft",
  "nl_query",
  "meeting_summary",
  "semantic_search",
  "duplicate_detection",
  "risk_flagging",
  "assistant",
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

/** Days a deal may sit in a stage before it is considered stalled. */
export const STAGE_STALL_THRESHOLD_DAYS: Record<Stage, number> = {
  Lead: 14,
  Contacted: 14,
  Proposal: 21,
  Negotiation: 21,
  Won: Infinity,
  Lost: Infinity,
};

export const EMAIL_TONES = ["professional", "friendly", "concise"] as const;
export type EmailTone = (typeof EMAIL_TONES)[number];

/** Third-party sources the CRM can ingest from. */
export const INTEGRATION_PLATFORMS = ["instagram", "facebook", "tiktok"] as const;
export type IntegrationPlatform = (typeof INTEGRATION_PLATFORMS)[number];

/** Which capabilities each platform actually offers, so the UI does not promise what it cannot do. */
export const PLATFORM_CAPABILITIES: Record<
  IntegrationPlatform,
  { messaging: boolean; leadForms: boolean; comments: boolean; pollingFallback: boolean; label: string }
> = {
  instagram: { messaging: true, leadForms: false, comments: true, pollingFallback: false, label: "Instagram" },
  facebook: { messaging: true, leadForms: true, comments: false, pollingFallback: false, label: "Facebook" },
  // TikTok's webhook tier is inconsistent, so polling is a first-class path rather than a fallback nobody built.
  tiktok: { messaging: false, leadForms: true, comments: false, pollingFallback: true, label: "TikTok" },
};

/** Things worth telling someone about, as opposed to everything that happens. */
export const NOTIFICATION_KINDS = [
  "deal_risk",
  "lead_received",
  "message_received",
  "duplicate_found",
  "task_due",
  "meeting_summarized",
  "integration_error",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
