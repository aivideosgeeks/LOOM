"use client";

import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import type {
  AssistantReply,
  IntegrationDTO,
  IntegrationPlatform,
  PlatformMessageDTO,
  SyncLogEntryDTO,
  SyncLogSummary,
  AiStatus,
  InviteDTO,
  InvitePreview,
  Role,
  AiUsageRow,
  ContactDTO,
  DealDTO,
  DuplicateCandidateDTO,
  EmailDraft,
  EmailTone,
  MeetingDTO,
  NoteDTO,
  SemanticSearchResponse,
  Stage,
  TaskDTO,
  UserDTO,
} from "@loom/shared";
import { api } from "./api";

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface DashboardData {
  pipeline: Array<{ stage: Stage; count: number; value: number }>;
  totals: { openDeals: number; openValue: number; wonValue: number; contacts: number; atRisk: number };
  atRiskDeals: DealDTO[];
  topDeals: DealDTO[];
  recentActivity: NoteDTO[];
  tasksDue: TaskDTO[];
}

export interface AskResponse {
  ok: boolean;
  entity?: "deals" | "contacts";
  explanation?: string;
  filters?: string[];
  rows?: DealDTO[] | ContactDTO[];
  count?: number;
  limit?: number;
  scopedToOwn?: boolean;
  translator?: "ai" | "heuristic";
  code?: "unsupported" | "invalid" | "unavailable";
  reason?: string;
  details?: string[];
}

export interface AiUsageResponse {
  days: number;
  status: { provider: string; model: string; configured: boolean; circuit: string; consecutiveFailures: number };
  rows: AiUsageRow[];
  totalCostUsd: number;
  daily: Array<{ day: string; feature: string; calls: number; estCostUsd: number; tokens: number }>;
  recent: Array<{
    id: string;
    feature: string;
    status: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    estCostUsd: number;
    latencyMs: number;
    error: string | null;
    createdAt: string;
  }>;
}

const qs = (params: object) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, string | number | boolean | undefined | null>)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
};

export const keys = {
  me: ["me"] as const,
  aiStatus: ["ai-status"] as const,
  dashboard: ["dashboard"] as const,
  users: ["users"] as const,
  deals: (params: object) => ["deals", params] as const,
  deal: (id: string) => ["deal", id] as const,
  contacts: (params: object) => ["contacts", params] as const,
  contact: (id: string) => ["contact", id] as const,
  tasks: (params: object) => ["tasks", params] as const,
  meeting: (id: string) => ["meeting", id] as const,
  duplicates: (status: string) => ["duplicates", status] as const,
  aiUsage: (days: number) => ["ai-usage", days] as const,
  search: (q: string) => ["search", q] as const,
  invites: ["invites"] as const,
  setupState: ["setup-state"] as const,
  owned: (id: string) => ["owned", id] as const,
  assistantHistory: ["assistant-history"] as const,
  integrations: ["integrations"] as const,
  syncLog: (platform: string) => ["sync-log", platform] as const,
  messages: (contactId: string) => ["messages", contactId] as const,
};

export function useMe(options: Partial<UseQueryOptions<{ user: UserDTO }>> = {}) {
  return useQuery({ queryKey: keys.me, queryFn: () => api<{ user: UserDTO }>("/api/auth/me"), staleTime: 60_000, ...options });
}

export function useAiStatus() {
  return useQuery({ queryKey: keys.aiStatus, queryFn: () => api<AiStatus>("/api/ai/status"), refetchInterval: 30_000 });
}

export function useDashboard() {
  return useQuery({ queryKey: keys.dashboard, queryFn: () => api<DashboardData>("/api/dashboard"), refetchInterval: 20_000 });
}

/** The roster is an admin-only route, so members never request it. */
export function useUsers() {
  const { data: me } = useMe();
  return useQuery({
    queryKey: keys.users,
    queryFn: () => api<{ users: UserDTO[] }>("/api/auth/users"),
    enabled: me?.user.role === "admin",
    staleTime: 300_000,
  });
}

export interface DealListParams {
  q?: string;
  stage?: Stage | "";
  atRisk?: "true" | "false" | "";
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  limit?: number;
}

export function useDeals(params: DealListParams) {
  return useQuery({ queryKey: keys.deals(params), queryFn: () => api<Paged<DealDTO>>(`/api/deals${qs(params)}`), placeholderData: (prev) => prev, refetchInterval: 15_000 });
}

export interface DealDetail {
  deal: DealDTO;
  notes: NoteDTO[];
  tasks: TaskDTO[];
  meetings: MeetingDTO[];
}

export function useDeal(id: string) {
  return useQuery({ queryKey: keys.deal(id), queryFn: () => api<DealDetail>(`/api/deals/${id}`), refetchInterval: 10_000 });
}

export interface ContactListParams {
  q?: string;
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  limit?: number;
}

export function useContacts(params: ContactListParams) {
  return useQuery({ queryKey: keys.contacts(params), queryFn: () => api<Paged<ContactDTO>>(`/api/contacts${qs(params)}`), placeholderData: (prev) => prev });
}

export interface ContactDetail {
  contact: ContactDTO;
  deals: DealDTO[];
  notes: NoteDTO[];
  tasks: TaskDTO[];
}

export function useContact(id: string) {
  return useQuery({ queryKey: keys.contact(id), queryFn: () => api<ContactDetail>(`/api/contacts/${id}`), refetchInterval: 10_000 });
}

export function useTasks(params: { done?: "true" | "false" | "" } = {}) {
  return useQuery({ queryKey: keys.tasks(params), queryFn: () => api<{ tasks: TaskDTO[] }>(`/api/tasks${qs(params)}`) });
}

export function useMeeting(id: string | null) {
  return useQuery({
    queryKey: keys.meeting(id ?? ""),
    queryFn: () => api<{ meeting: MeetingDTO }>(`/api/meetings/${id}`),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.meeting.status;
      return status === "pending" || status === "processing" ? 2_000 : false;
    },
  });
}

export function useDuplicates(status: "pending" | "all" = "pending") {
  return useQuery({ queryKey: keys.duplicates(status), queryFn: () => api<{ candidates: DuplicateCandidateDTO[]; pending: number }>(`/api/duplicates?status=${status}`) });
}

export function useAiUsage(days: number) {
  return useQuery({ queryKey: keys.aiUsage(days), queryFn: () => api<AiUsageResponse>(`/api/admin/ai-usage?days=${days}`), refetchInterval: 15_000 });
}

export function useSemanticSearch(q: string) {
  return useQuery({ queryKey: keys.search(q), queryFn: () => api<SemanticSearchResponse>(`/api/ai/search?q=${encodeURIComponent(q)}&limit=15`), enabled: q.trim().length > 0 });
}

/** Invalidate everything that could have changed after a write. */
function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["deals"] });
    void qc.invalidateQueries({ queryKey: ["deal"] });
    void qc.invalidateQueries({ queryKey: ["contacts"] });
    void qc.invalidateQueries({ queryKey: ["contact"] });
    void qc.invalidateQueries({ queryKey: ["tasks"] });
    void qc.invalidateQueries({ queryKey: keys.dashboard });
    void qc.invalidateQueries({ queryKey: ["duplicates"] });
  };
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) => api<{ user: UserDTO }>("/api/auth/login", { method: "POST", json: input }),
    onSuccess: (data) => qc.setQueryData(keys.me, data),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: true }>("/api/auth/logout", { method: "POST" }),
    onSuccess: () => qc.clear(),
  });
}

export function useCreateContact() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (input: object) => api<{ contact: ContactDTO }>("/api/contacts", { method: "POST", json: input }), onSuccess: invalidate });
}

export function useUpdateContact(id: string) {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (input: object) => api<{ contact: ContactDTO }>(`/api/contacts/${id}`, { method: "PATCH", json: input }), onSuccess: invalidate });
}

export function useDeleteContact() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (id: string) => api<{ ok: true }>(`/api/contacts/${id}`, { method: "DELETE" }), onSuccess: invalidate });
}

export function useCreateDeal() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (input: object) => api<{ deal: DealDTO }>("/api/deals", { method: "POST", json: input }), onSuccess: invalidate });
}

export function useUpdateDeal(id: string) {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (input: object) => api<{ deal: DealDTO }>(`/api/deals/${id}`, { method: "PATCH", json: input }), onSuccess: invalidate });
}

export function useDeleteDeal() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (id: string) => api<{ ok: true }>(`/api/deals/${id}`, { method: "DELETE" }), onSuccess: invalidate });
}

export function useRescoreDeal(id: string) {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: () => api<{ deal: DealDTO }>(`/api/deals/${id}/rescore`, { method: "POST" }), onSuccess: invalidate });
}

export function useCreateNote() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: { content: string; kind: string; deal?: string; contact?: string }) => api<{ note: NoteDTO }>("/api/notes", { method: "POST", json: input }),
    onSuccess: invalidate,
  });
}

export function useDeleteNote() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (id: string) => api<{ ok: true }>(`/api/notes/${id}`, { method: "DELETE" }), onSuccess: invalidate });
}

export function useCreateTask() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (input: { title: string; deal?: string; contact?: string; dueDate?: string | null }) => api<{ task: TaskDTO }>("/api/tasks", { method: "POST", json: input }), onSuccess: invalidate });
}

export function useUpdateTask() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: ({ id, ...input }: { id: string; done?: boolean; title?: string; dueDate?: string | null }) => api<{ task: TaskDTO }>(`/api/tasks/${id}`, { method: "PATCH", json: input }), onSuccess: invalidate });
}

export function useDraftEmail(target: { deal?: string; contact?: string }) {
  const path = target.deal ? `/api/deals/${target.deal}/draft-email` : `/api/contacts/${target.contact}/draft-email`;
  return useMutation({ mutationFn: (input: { intent?: string; tone: EmailTone }) => api<{ draft: EmailDraft }>(path, { method: "POST", json: input }) });
}

export function useSendEmail(target: { deal?: string; contact?: string }) {
  const invalidate = useInvalidateAll();
  const path = target.deal ? `/api/deals/${target.deal}/emails` : `/api/contacts/${target.contact}/emails`;
  return useMutation({
    mutationFn: (input: { to: string; subject: string; body: string }) => api<{ sent: boolean; detail: string; note: NoteDTO }>(path, { method: "POST", json: input }),
    onSuccess: invalidate,
  });
}

export function useCreateMeeting(dealId: string) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: { title?: string; transcript: string }) => api<{ meeting: MeetingDTO }>(`/api/deals/${dealId}/meetings`, { method: "POST", json: input }),
    onSuccess: invalidate,
  });
}

export function useAsk() {
  return useMutation({
    mutationFn: async (question: string) => {
      try {
        return await api<AskResponse>("/api/ai/ask", { method: "POST", json: { question } });
      } catch (err) {
        // 422 carries the structured rejection (code/reason/details) we want to render, not toast.
        const e = err as { status?: number; body?: AskResponse | null; details?: unknown; message?: string };
        if (e.status === 422) {
          if (e.body && typeof e.body === "object" && "code" in e.body) return e.body;
          return { ok: false, code: "invalid", reason: e.message ?? "Rejected", details: [] } as AskResponse;
        }
        throw err;
      }
    },
  });
}

export function useMergeDuplicate() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: ({ id, survivorId }: { id: string; survivorId: string }) => api<{ contact: ContactDTO }>(`/api/duplicates/${id}/merge`, { method: "POST", json: { survivorId } }), onSuccess: invalidate });
}

export function useDismissDuplicate() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (id: string) => api<{ ok: true }>(`/api/duplicates/${id}/dismiss`, { method: "POST" }), onSuccess: invalidate });
}

export function useRunJob() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (name: "risk-scan" | "rescore" | "dedupe-scan") => api<{ queued: string }>(`/api/admin/jobs/${name}`, { method: "POST" }), onSuccess: invalidate });
}

export function useScanDuplicates() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: () => api<{ queued: boolean }>("/api/duplicates/scan", { method: "POST" }), onSuccess: invalidate });
}


// ---- Accounts: setup, invitations and team management ----

export function useSetupState() {
  return useQuery({ queryKey: keys.setupState, queryFn: () => api<{ needsSetup: boolean }>("/api/auth/setup-state"), staleTime: 30_000, retry: false });
}

export function useSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; email: string; password: string }) => api<{ user: UserDTO }>("/api/auth/setup", { method: "POST", json: input }),
    onSuccess: (data) => qc.setQueryData(keys.me, data),
  });
}

export function useInvitePreview(token: string) {
  return useQuery({
    queryKey: ["invite", token],
    queryFn: () => api<{ invite: InvitePreview }>(`/api/auth/invites/${encodeURIComponent(token)}`),
    enabled: !!token,
    retry: false,
  });
}

export function useAcceptInvite(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; password: string }) =>
      api<{ user: UserDTO }>(`/api/auth/invites/${encodeURIComponent(token)}/accept`, { method: "POST", json: input }),
    onSuccess: (data) => qc.setQueryData(keys.me, data),
  });
}

export function useInvites() {
  const { data: me } = useMe();
  return useQuery({
    queryKey: keys.invites,
    queryFn: () => api<{ invites: InviteDTO[] }>("/api/auth/invites"),
    enabled: me?.user.role === "admin",
  });
}

function useRefreshTeam() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.invites });
    void qc.invalidateQueries({ queryKey: keys.users });
  };
}

export function useCreateInvite() {
  const refresh = useRefreshTeam();
  return useMutation({
    mutationFn: (input: { email: string; role: Role; name?: string }) => api<{ invite: InviteDTO }>("/api/auth/invites", { method: "POST", json: input }),
    onSuccess: refresh,
  });
}

export function useResendInvite() {
  const refresh = useRefreshTeam();
  return useMutation({
    mutationFn: (id: string) => api<{ invite: InviteDTO }>(`/api/auth/invites/${id}/resend`, { method: "POST" }),
    onSuccess: refresh,
  });
}

export function useRevokeInvite() {
  const refresh = useRefreshTeam();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/api/auth/invites/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
}

export function useChangeRole() {
  const refresh = useRefreshTeam();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => api<{ user: UserDTO }>(`/api/auth/users/${id}/role`, { method: "PATCH", json: { role } }),
    onSuccess: refresh,
  });
}

export function useRemoveUser() {
  const refresh = useRefreshTeam();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/api/auth/users/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
}

export interface AssistantHistoryItem {
  id: string;
  message: string;
  kind: "answer" | "record" | "guide" | "refused" | "applied";
  summary: string;
  applied: string[];
  createdAt: string;
}

/**
 * Past exchanges, from the server rather than component state, so a reload or a
 * different device still shows what was asked.
 */
export function useAssistantHistory() {
  return useQuery({
    queryKey: keys.assistantHistory,
    queryFn: () => api<{ items: AssistantHistoryItem[] }>("/api/ai/assistant/history"),
    staleTime: 30_000,
  });
}

export function useAssistant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => api<AssistantReply>("/api/ai/assistant", { method: "POST", json: { message } }),
    onSuccess: (reply) => {
      void qc.invalidateQueries({ queryKey: keys.assistantHistory });
      // The assistant writes directly, so anything on screen may now be stale.
      if (reply.kind === "applied") {
        for (const key of ["deals", "deal", "contacts", "contact", "tasks", "dashboard"]) {
          void qc.invalidateQueries({ queryKey: [key] });
        }
      }
    },
  });
}

export function useClearAssistantHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: true }>("/api/ai/assistant/history", { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.assistantHistory }),
  });
}

/* ---------------------------------------------------------------- integrations */

export function useIntegrations(enabled = true) {
  return useQuery({
    queryKey: keys.integrations,
    queryFn: () => api<{ integrations: IntegrationDTO[] }>("/api/integrations"),
    enabled,
    staleTime: 30_000,
  });
}

export function useConnectIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ platform, ...body }: { platform: IntegrationPlatform; accessToken: string; externalId?: string; externalName?: string }) =>
      api<{ integration: IntegrationDTO }>(`/api/integrations/${platform}/connect`, { method: "POST", json: body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.integrations }),
  });
}

export function useDisconnectIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (platform: IntegrationPlatform) => api<{ ok: true }>(`/api/integrations/${platform}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.integrations }),
  });
}

export function useSyncLog(platform: string, enabled = true) {
  return useQuery({
    queryKey: keys.syncLog(platform),
    queryFn: () =>
      api<{ summary: SyncLogSummary[]; events: SyncLogEntryDTO[] }>(
        `/api/integrations/sync-log${platform === "all" ? "" : `?platform=${platform}`}`,
      ),
    enabled,
    // The log is the place you look when something is wrong, so it refreshes itself.
    refetchInterval: 20_000,
  });
}

/** The conversation on a contact. Polled, as the briefs specify, since there is no socket. */
export function useMessages(contactId: string, enabled = true) {
  return useQuery({
    queryKey: keys.messages(contactId),
    queryFn: () => api<{ messages: PlatformMessageDTO[] }>(`/api/integrations/messages/${contactId}`),
    enabled,
    refetchInterval: 20_000,
  });
}

export function useSendMessage(contactId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { platform: IntegrationPlatform; text: string }) =>
      api<{ message: PlatformMessageDTO }>(`/api/integrations/messages/${contactId}`, { method: "POST", json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.messages(contactId) });
      // An outbound reply becomes a note, so the timeline is stale too.
      void qc.invalidateQueries({ queryKey: keys.contact(contactId) });
    },
  });
}
