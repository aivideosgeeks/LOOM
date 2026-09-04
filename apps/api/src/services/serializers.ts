import type { IntegrationPlatform, ContactDTO, DealDTO, DuplicateCandidateDTO, MeetingDTO, NoteDTO, TaskDTO, UserDTO } from "@loom/shared";
import { toIso } from "../lib/dates";

type AnyDoc = Record<string, any>;

function plain(doc: AnyDoc): AnyDoc {
  return typeof doc?.toObject === "function" ? doc.toObject() : doc;
}

export function refId(ref: unknown): string | null {
  if (!ref) return null;
  if (typeof ref === "string") return ref;
  const anyRef = ref as AnyDoc;
  if (anyRef._id) return String(anyRef._id);
  return String(ref);
}

function isPopulated(ref: unknown): ref is AnyDoc {
  return !!ref && typeof ref === "object" && "_id" in (ref as AnyDoc) && Object.keys(ref as AnyDoc).length > 1;
}

export function toUserDTO(user: unknown): UserDTO | null {
  if (!isPopulated(user)) return null;
  const u = plain(user);
  return { id: String(u._id), name: u.name, email: u.email, role: u.role };
}

export function toContactDTO(doc: AnyDoc, extra: Partial<ContactDTO> = {}): ContactDTO {
  const c = plain(doc);
  return {
    id: String(c._id),
    name: c.name,
    email: c.email ?? null,
    phone: c.phone ?? null,
    company: c.company ?? null,
    tags: c.tags ?? [],
    notes: c.notes ?? null,
    owner: toUserDTO(c.owner),
    score: c.score ?? 0,
    lastActivityAt: toIso(c.lastActivityAt) ?? toIso(c.createdAt) ?? new Date().toISOString(),
    createdAt: toIso(c.createdAt) ?? "",
    updatedAt: toIso(c.updatedAt) ?? "",
    // Platform and handle only. The external id is a routing identifier and has
    // no business leaving the server.
    externalRefs: (c.externalRefs ?? []).map((r: { platform: string; handle?: string | null }) => ({
      platform: r.platform as IntegrationPlatform,
      handle: r.handle ?? null,
    })),
    ...extra,
  };
}

export function toDealDTO(doc: AnyDoc): DealDTO {
  const d = plain(doc);
  const contact = isPopulated(d.contact)
    ? { id: String(d.contact._id), name: d.contact.name, company: d.contact.company ?? null, email: d.contact.email ?? null }
    : d.contact
      ? { id: String(d.contact), name: "", company: null, email: null }
      : null;
  return {
    id: String(d._id),
    title: d.title,
    contact,
    value: d.value ?? 0,
    stage: d.stage,
    owner: toUserDTO(d.owner),
    expectedCloseDate: toIso(d.expectedCloseDate),
    stageEnteredAt: toIso(d.stageEnteredAt) ?? toIso(d.createdAt) ?? "",
    lastActivityAt: toIso(d.lastActivityAt) ?? toIso(d.createdAt) ?? "",
    score: d.score ?? 0,
    scoreBreakdown: d.scoreBreakdown ?? null,
    scoredAt: toIso(d.scoredAt),
    risk: d.risk ?? null,
    createdAt: toIso(d.createdAt) ?? "",
    updatedAt: toIso(d.updatedAt) ?? "",
  };
}

export function toNoteDTO(doc: AnyDoc): NoteDTO {
  const n = plain(doc);
  return {
    id: String(n._id),
    kind: n.kind,
    content: n.content,
    deal: refId(n.deal),
    contact: refId(n.contact),
    author: toUserDTO(n.author),
    sentiment: n.sentiment ?? null,
    meeting: refId(n.meeting),
    suspicious: !!n.suspicious,
    createdAt: toIso(n.createdAt) ?? "",
  };
}

export function toTaskDTO(doc: AnyDoc): TaskDTO {
  const t = plain(doc);
  return {
    id: String(t._id),
    title: t.title,
    deal: refId(t.deal),
    contact: refId(t.contact),
    dueDate: toIso(t.dueDate),
    done: !!t.done,
    source: t.source ?? "manual",
    meeting: refId(t.meeting),
    createdAt: toIso(t.createdAt) ?? "",
  };
}

export function toMeetingDTO(doc: AnyDoc): MeetingDTO {
  const m = plain(doc);
  return {
    id: String(m._id),
    title: m.title,
    deal: refId(m.deal),
    contact: refId(m.contact),
    status: m.status,
    result: m.result ?? null,
    error: m.error ?? null,
    source: m.source ?? null,
    createdAt: toIso(m.createdAt) ?? "",
    completedAt: toIso(m.completedAt),
  };
}

export function toDuplicateDTO(doc: AnyDoc): DuplicateCandidateDTO {
  const d = plain(doc);
  return {
    id: String(d._id),
    a: toContactDTO(d.a),
    b: toContactDTO(d.b),
    score: d.score,
    reasons: d.reasons ?? [],
    aiVerdict: d.aiVerdict ?? null,
    status: d.status,
    createdAt: toIso(d.createdAt) ?? "",
  };
}
