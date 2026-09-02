import { z } from "zod";
import { sha256 } from "../../lib/hash";
import { logger } from "../../lib/logger";
import { Contact, DuplicateCandidate } from "../../models";
import { callStructured } from "../gateway";
import { DUPLICATE_JUDGE_SYSTEM } from "../prompts";
import { wrapData } from "../sanitize";

/**
 * Duplicate contact detection = cheap deterministic candidate generation
 * (email edit distance, phone match, name similarity with nickname expansion,
 * same company + similar name) followed by an optional LLM adjudication that
 * attaches a verdict + reason to each candidate pair. Nothing is ever merged
 * automatically: candidates land in a review queue for an admin.
 */

export interface ContactLike {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
}

export const DUPLICATE_THRESHOLD = 0.6;

const NICKNAMES: Record<string, string> = {
  bob: "robert", rob: "robert", bobby: "robert", bill: "william", will: "william", billy: "william", liz: "elizabeth", beth: "elizabeth",
  betty: "elizabeth", eliza: "elizabeth", mike: "michael", mick: "michael", jim: "james", jimmy: "james", jamie: "james", jon: "jonathan",
  jack: "john", johnny: "john", dave: "david", davey: "david", dan: "daniel", danny: "daniel", tom: "thomas", tommy: "thomas", chris: "christopher",
  kate: "katherine", katie: "katherine", kathy: "katherine", cathy: "catherine", sam: "samuel", sammy: "samuel", alex: "alexander", andy: "andrew",
  drew: "andrew", tony: "anthony", ben: "benjamin", benny: "benjamin", steve: "steven", stephen: "steven", joe: "joseph", joey: "joseph", nick: "nicholas",
  matt: "matthew", pat: "patrick", rick: "richard", rich: "richard", dick: "richard", ed: "edward", eddie: "edward", ted: "edward", jen: "jennifer",
  jenny: "jennifer", jess: "jessica", meg: "margaret", maggie: "margaret", peggy: "margaret", sue: "susan", susie: "susan", debbie: "deborah",
  deb: "deborah", trish: "patricia", tricia: "patricia", becky: "rebecca", vicky: "victoria", tori: "victoria", nate: "nathan", greg: "gregory",
  ron: "ronald", ronnie: "ronald", ray: "raymond", larry: "lawrence", jerry: "gerald", terry: "terrence", ken: "kenneth", kenny: "kenneth",
  charlie: "charles", chuck: "charles", frank: "francis", fred: "frederick", harry: "henry", hank: "henry", abby: "abigail", gabe: "gabriel",
  sasha: "alexander", lou: "louis", manny: "manuel", pete: "peter", phil: "philip", ollie: "oliver", theo: "theodore", tim: "timothy", zach: "zachary",
};

const COMPANY_SUFFIX = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|gmbh|plc|sa|ag|group|holdings|technologies|technology|tech|labs|software|solutions)\b/g;

export function normalizeEmail(email?: string | null): { local: string; domain: string } | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at <= 0) return null;
  let local = e.slice(0, at).replace(/\+.*$/, "");
  const domain = e.slice(at + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") local = local.replace(/\./g, "");
  return { local, domain: domain === "googlemail.com" ? "gmail.com" : domain };
}

export function normalizeName(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !["mr", "mrs", "ms", "dr", "jr", "sr", "ii", "iii"].includes(t))
    .map((t) => NICKNAMES[t] ?? t);
}

export function normalizeCompany(company?: string | null): string {
  if (!company) return "";
  return company.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^a-z0-9\s]/g, " ").replace(COMPANY_SUFFIX, " ").replace(/\s+/g, " ").trim();
}

export function normalizePhone(phone?: string | null): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function damerauLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) d[i][0] = i;
  for (let j = 0; j <= n; j += 1) d[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

export function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  if (!s1.length || !s2.length) return 0;
  const matchDistance = Math.max(0, Math.floor(Math.max(s1.length, s2.length) / 2) - 1);
  const s1Matches = new Array<boolean>(s1.length).fill(false);
  const s2Matches = new Array<boolean>(s2.length).fill(false);
  let matches = 0;
  for (let i = 0; i < s1.length; i += 1) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, s2.length);
    for (let j = start; j < end; j += 1) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches += 1;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < s1.length; i += 1) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k += 1;
    if (s1[i] !== s2[k]) t += 1;
    k += 1;
  }
  const jaro = (matches / s1.length + matches / s2.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i += 1) {
    if (s1[i] === s2[i]) prefix += 1;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** 0..1 similarity of two person names, tolerant of nicknames, order and typos. */
export function nameSimilarity(a: string, b: string): number {
  const ta = normalizeName(a);
  const tb = normalizeName(b);
  if (!ta.length || !tb.length) return 0;
  const joinedA = ta.join(" ");
  const joinedB = tb.join(" ");
  if (joinedA === joinedB) return 1;
  const sortedSim = jaroWinkler([...ta].sort().join(" "), [...tb].sort().join(" "));
  // token-level: best match per token
  let tokenTotal = 0;
  for (const x of ta) {
    let best = 0;
    for (const y of tb) best = Math.max(best, x === y ? 1 : x[0] === y[0] && (x.length === 1 || y.length === 1) ? 0.85 : jaroWinkler(x, y));
    tokenTotal += best;
  }
  const tokenSim = tokenTotal / Math.max(ta.length, tb.length);
  return Math.max(jaroWinkler(joinedA, joinedB), sortedSim, tokenSim);
}

export interface PairScore {
  score: number;
  reasons: string[];
}

/** Deterministic pair scoring. Threshold DUPLICATE_THRESHOLD decides whether a candidate is queued. */
export function scorePair(a: ContactLike, b: ContactLike): PairScore {
  const reasons: string[] = [];
  let score = 0;

  const ea = normalizeEmail(a.email);
  const eb = normalizeEmail(b.email);
  let emailConflict = false;
  if (ea && eb) {
    if (ea.local === eb.local && ea.domain === eb.domain) {
      score += 1;
      reasons.push("Identical email address");
    } else {
      const localDist = damerauLevenshtein(ea.local, eb.local);
      const domainDist = damerauLevenshtein(ea.domain, eb.domain);
      if (localDist <= 2 && domainDist === 0) {
        score += 0.9;
        reasons.push(`Email differs by ${localDist} character(s) (${a.email} vs ${b.email})`);
      } else if (localDist === 0 && domainDist <= 2) {
        score += 0.85;
        reasons.push(`Email domain looks mistyped (${ea.domain} vs ${eb.domain})`);
      } else if (localDist <= 1 && domainDist <= 1) {
        score += 0.8;
        reasons.push(`Very similar email (${a.email} vs ${b.email})`);
      } else {
        emailConflict = true;
      }
    }
  }

  const pa = normalizePhone(a.phone);
  const pb = normalizePhone(b.phone);
  if (pa && pb && pa.length >= 7 && pa === pb) {
    score += 0.5;
    reasons.push("Same phone number");
  }

  const nameSim = nameSimilarity(a.name, b.name);
  let nameScore = 0;
  if (nameSim >= 0.95) nameScore = 0.6;
  else if (nameSim >= 0.88) nameScore = 0.45;
  else if (nameSim >= 0.8) nameScore = 0.3;
  if (nameScore) {
    score += nameScore;
    reasons.push(nameSim >= 0.95 ? "Same or equivalent name" : `Similar names (${Math.round(nameSim * 100)}% match)`);
  }

  const ca = normalizeCompany(a.company);
  const cb = normalizeCompany(b.company);
  if (ca && cb && nameScore > 0 && (ca === cb || jaroWinkler(ca, cb) >= 0.92)) {
    score += 0.25;
    reasons.push("Same company");
  }

  if (emailConflict && nameSim < 0.95) {
    score -= 0.3;
  }

  score = Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  return { score, reasons };
}

export function pairKey(idA: string, idB: string): string {
  return [idA, idB].sort().join(":");
}

/**
 * Blocking keys. Comparing every contact against every other is O(n²): at 1,200
 * contacts that is 719k comparisons, and it grows to minutes of CPU by 10k.
 *
 * A real duplicate almost always agrees on at least one cheap, exact signal, so
 * we only compare contacts that share one of these keys. Pairs are still scored
 * by the full fuzzy matcher; blocking only decides which pairs are worth scoring.
 *
 * Each key is deliberately tolerant of the error class it is meant to survive:
 *   - a typo'd email local part still shares the domain + surname key
 *   - a typo'd domain still shares the local part key
 *   - a reformatted phone still shares its last 7 digits
 *   - a nickname still shares the surname + company key (nicknames are normalised)
 */
export function blockingKeys(c: ContactLike): string[] {
  const keys = new Set<string>();
  const email = normalizeEmail(c.email);
  const tokens = normalizeName(c.name);
  const surname = tokens.length ? tokens[tokens.length - 1] : "";
  const company = normalizeCompany(c.company);
  const phone = normalizePhone(c.phone);

  if (email) {
    keys.add(`el:${email.local}`);
    if (surname) keys.add(`ed:${email.domain}|${surname}`);
  }
  if (phone.length >= 7) keys.add(`ph:${phone.slice(-7)}`);
  if (surname && company) keys.add(`sc:${surname}|${company}`);
  if (surname && tokens.length > 1) keys.add(`fs:${tokens[0][0]}|${surname}`);
  if (tokens.length) keys.add(`nm:${[...tokens].sort().join(" ")}`);
  return [...keys];
}

/** Candidate pairs worth scoring, found by shared blocking key instead of a full cross join. */
export function candidatePairs(contacts: ContactLike[]): Array<[ContactLike, ContactLike]> {
  const blocks = new Map<string, ContactLike[]>();
  for (const c of contacts) {
    for (const key of blockingKeys(c)) {
      const bucket = blocks.get(key);
      if (bucket) bucket.push(c);
      else blocks.set(key, [c]);
    }
  }
  const seen = new Set<string>();
  const pairs: Array<[ContactLike, ContactLike]> = [];
  for (const bucket of blocks.values()) {
    // A key shared by a huge number of records carries no signal (and would
    // reintroduce the quadratic blow-up), so skip it.
    if (bucket.length < 2 || bucket.length > 60) continue;
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const key = pairKey(bucket[i].id, bucket[j].id);
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push([bucket[i], bucket[j]]);
      }
    }
  }
  return pairs;
}

export const duplicateVerdictSchema = z.object({
  isDuplicate: z.boolean(),
  confidence: z.number(),
  reason: z.string(),
});

function describe(c: ContactLike): string {
  return `Name: ${c.name}\nEmail: ${c.email ?? "unknown"}\nPhone: ${c.phone ?? "unknown"}\nCompany: ${c.company ?? "unknown"}`;
}

async function judgePair(a: ContactLike, b: ContactLike, rule: PairScore) {
  const result = await callStructured({
    feature: "duplicate_detection",
    schema: duplicateVerdictSchema,
    system: DUPLICATE_JUDGE_SYSTEM,
    user: `${wrapData("contact_a", describe(a), { id: a.id }, 600)}\n\n${wrapData("contact_b", describe(b), { id: b.id }, 600)}\n\nRule-based similarity: ${rule.score} (${rule.reasons.join("; ") || "none"})`,
    effort: "low",
    maxTokens: 1024,
    timeoutMs: 25_000,
    cache: { key: sha256({ a: describe(a), b: describe(b) }), ttlMs: 30 * 86_400_000 },
  });
  if (!result.ok) return null;
  return {
    isDuplicate: result.data.isDuplicate,
    confidence: Math.max(0, Math.min(1, Number(result.data.confidence) || 0)),
    reason: result.data.reason.slice(0, 300),
  };
}

function toLike(c: { _id: unknown; name: string; email?: string | null; phone?: string | null; company?: string | null }): ContactLike {
  return { id: String(c._id), name: c.name, email: c.email ?? null, phone: c.phone ?? null, company: c.company ?? null };
}

/** Idempotent: the same pair can be discovered from both sides by concurrent jobs. */
async function upsertCandidate(a: ContactLike, b: ContactLike, rule: PairScore): Promise<boolean> {
  const key = pairKey(a.id, b.id);
  const existing = await DuplicateCandidate.findOne({ pairKey: key }).lean();
  if (existing && existing.status !== "pending") return false; // already merged or dismissed
  const verdict = await judgePair(a, b, rule);
  try {
    const res = await DuplicateCandidate.updateOne(
      { pairKey: key, status: "pending" },
      {
        $set: { score: rule.score, reasons: rule.reasons, aiVerdict: verdict ?? existing?.aiVerdict ?? null },
        $setOnInsert: { a: a.id, b: b.id, pairKey: key, status: "pending" },
      },
      { upsert: true },
    );
    return res.upsertedCount > 0;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false; // lost a race with the mirror job; the other write wins
    throw err;
  }
}

/**
 * Compare one contact against the others that share a blocking key with it, rather
 * than against the whole table.
 */
export async function findDuplicatesForContact(contactId: string): Promise<number> {
  const contact = await Contact.findById(contactId).lean();
  if (!contact || contact.mergedInto) return 0;
  const me = toLike(contact);
  const others = await Contact.find({ _id: { $ne: contact._id }, mergedInto: null }).select("name email phone company").lean();
  const myKeys = new Set(blockingKeys(me));
  let compared = 0;
  let created = 0;
  for (const other of others) {
    const candidate = toLike(other);
    if (!blockingKeys(candidate).some((k) => myKeys.has(k))) continue;
    compared += 1;
    const rule = scorePair(me, candidate);
    if (rule.score < DUPLICATE_THRESHOLD) continue;
    if (await upsertCandidate(me, candidate, rule)) created += 1;
  }
  if (created) logger.info({ contactId, compared, created }, "Duplicate candidates queued");
  return created;
}

export async function scanAllContactsForDuplicates(): Promise<number> {
  const contacts = await Contact.find({ mergedInto: null }).select("name email phone company").lean();
  const pairs = candidatePairs(contacts.map(toLike));
  let created = 0;
  for (const [a, b] of pairs) {
    const rule = scorePair(a, b);
    if (rule.score < DUPLICATE_THRESHOLD) continue;
    if (await upsertCandidate(a, b, rule)) created += 1;
  }
  logger.info(
    { contacts: contacts.length, pairsCompared: pairs.length, fullCrossJoin: (contacts.length * (contacts.length - 1)) / 2, created },
    "Duplicate scan complete",
  );
  return created;
}
