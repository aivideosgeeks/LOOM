import type { AiFeature, NoteKind, Role, Stage } from "./constants";

export interface ScoreBreakdown {
  stagePrior: number;
  recency: number;
  value: number;
  velocity: number;
  sentiment: number;
  engagement: number;
  total: number;
  computedAt: string;
  inputs: {
    stage: Stage;
    daysSinceActivity: number;
    daysInStage: number;
    value: number;
    avgSentiment: number | null;
    sentimentTrend: number | null;
    engagementCount30d: number;
    sentimentSamples: number;
  };
}

export type RiskSignal = "stalled" | "inactive" | "sentiment_negative" | "closing_soon_unready";

export interface RiskFlag {
  atRisk: boolean;
  signals: RiskSignal[];
  reasons: string[];
  aiReason: string | null;
  suggestedAction: string | null;
  reasonSource: "ai" | "template" | null;
  flaggedAt: string | null;
  checkedAt: string | null;
}

export type SentimentLabel = "positive" | "neutral" | "negative";

export interface Sentiment {
  score: number; // -1 .. 1
  label: SentimentLabel;
  source: "ai" | "lexicon" | "manual";
  rationale?: string | null;
}

export interface UserDTO {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface InviteDTO {
  id: string;
  email: string;
  role: Role;
  name: string | null;
  invitedBy: UserDTO | null;
  expiresAt: string;
  expired: boolean;
  createdAt: string;
  /** Present only in the response to creating or resending an invite, never when listing. */
  link?: string;
  emailed?: boolean;
  emailDetail?: string;
}

/** What an invitee is shown before they choose a password. */
export interface InvitePreview {
  email: string;
  role: Role;
  name: string | null;
  invitedByName: string | null;
}

export interface ContactDTO {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  tags: string[];
  notes: string | null;
  owner: UserDTO | null;
  score: number;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
  openDeals?: number;
  duplicateCandidates?: number;
}

export interface DealDTO {
  id: string;
  title: string;
  contact: { id: string; name: string; company: string | null; email: string | null } | null;
  value: number;
  stage: Stage;
  owner: UserDTO | null;
  expectedCloseDate: string | null;
  stageEnteredAt: string;
  lastActivityAt: string;
  score: number;
  scoreBreakdown: ScoreBreakdown | null;
  scoredAt: string | null;
  risk: RiskFlag | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteDTO {
  id: string;
  kind: NoteKind;
  content: string;
  deal: string | null;
  contact: string | null;
  author: UserDTO | null;
  sentiment: Sentiment | null;
  meeting: string | null;
  suspicious: boolean;
  createdAt: string;
}

export interface TaskDTO {
  id: string;
  title: string;
  deal: string | null;
  contact: string | null;
  dueDate: string | null;
  done: boolean;
  source: "manual" | "meeting";
  meeting: string | null;
  createdAt: string;
}

export interface MeetingActionItem {
  title: string;
  owner: string | null;
  dueDate: string | null;
}

export interface MeetingResult {
  summary: string;
  actionItems: MeetingActionItem[];
  sentiment: Sentiment;
  nextSteps: string[];
  keyTopics: string[];
}

export interface MeetingDTO {
  id: string;
  title: string;
  deal: string | null;
  contact: string | null;
  status: "pending" | "processing" | "done" | "failed";
  result: MeetingResult | null;
  error: string | null;
  source: "ai" | "fallback" | null;
  createdAt: string;
  completedAt: string | null;
}

export interface EmailDraft {
  subject: string;
  body: string;
  source: "ai" | "template";
  reasoning?: string | null;
}

export interface DuplicateCandidateDTO {
  id: string;
  a: ContactDTO;
  b: ContactDTO;
  score: number;
  reasons: string[];
  aiVerdict: { isDuplicate: boolean; confidence: number; reason: string } | null;
  status: "pending" | "merged" | "dismissed";
  createdAt: string;
}

export interface AiStatus {
  /** Gateway in use: anthropic, openrouter, groq, custom, or stub when none is configured. */
  provider: string;
  model: string;
  configured: boolean;
  circuit: "closed" | "open" | "half_open";
  consecutiveFailures: number;
  embeddings: { provider: string; model: string; ready: boolean };
  vectorStore: { provider: string; healthy: boolean };
  queue: { provider: "bullmq" | "memory" };
}

export interface AiUsageRow {
  feature: AiFeature;
  calls: number;
  cached: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  estCostUsd: number;
  avgLatencyMs: number;
}

export interface SemanticSearchHit {
  note: NoteDTO;
  score: number;
  deal: { id: string; title: string } | null;
  contact: { id: string; name: string } | null;
}

export interface SemanticSearchResponse {
  mode: "semantic" | "text";
  degradedReason: string | null;
  hits: SemanticSearchHit[];
}
