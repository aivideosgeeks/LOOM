/**
 * Scale benchmark. Loads a synthetic dataset into an in-memory MongoDB and times the
 * paths that are known to grow super-linearly, so optimisation work is aimed at
 * measured bottlenecks rather than guesses.
 *
 *   npm run bench -w @loom/api            # default 2000 contacts
 *   CONTACTS=10000 npm run bench -w @loom/api
 */
import mongoose, { Types } from "mongoose";
import bcrypt from "bcryptjs";
import { OPEN_STAGES, PIPELINE_STAGES, type Stage } from "@loom/shared";
import { connectDb } from "../db/connect";
import { Contact, Deal, Note, NoteEmbedding, User } from "../models";
import { candidatePairs, scorePair, type ContactLike } from "../ai/features/duplicates";
import { cosine, packVector, unpackVector } from "../ai/embeddings/vectorStore";

const N_CONTACTS = Number(process.env.CONTACTS ?? 2000);
const N_DEALS = Number(process.env.DEALS ?? N_CONTACTS);
const N_NOTES = Number(process.env.NOTES ?? N_CONTACTS * 3);
const DIMS = 384;

const FIRST = ["Robert", "Elizabeth", "Priya", "Marcus", "Dana", "Gavin", "Nina", "Miles", "Kate", "Frank", "Alice", "Ben", "Cara", "Omar", "Yuki", "Sofia"];
const LAST = ["Chen", "Turner", "Natarajan", "Lee", "Whitfield", "Park", "Sharp", "Dyson", "Austen", "Thorn", "Okafor", "Rossi", "Haddad", "Novak"];
const CO = ["Northwind", "Globex", "Initech", "Umbrella", "Acme", "Hooli", "Stark", "Wayne", "Tyrell", "Soylent", "Oceanic", "Cyberdyne"];

const pick = <T,>(a: T[], i: number) => a[i % a.length];
const rand = (n: number) => Math.floor(Math.random() * n);

function timer() {
  const t0 = process.hrtime.bigint();
  return () => Number(process.hrtime.bigint() - t0) / 1e6;
}

function unitVector(): number[] {
  const v = Array.from({ length: DIMS }, () => Math.random() * 2 - 1);
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / norm);
}

async function main() {
  const db = await connectDb({ dbName: `bench-${Date.now()}` });
  const results: Array<{ op: string; ms: number; note: string }> = [];
  const record = (op: string, ms: number, note = "") => {
    results.push({ op, ms, note });
    console.log(`  ${op.padEnd(46)} ${ms.toFixed(1).padStart(9)} ms  ${note}`);
  };

  console.log(`\nSeeding ${N_CONTACTS} contacts, ${N_DEALS} deals, ${N_NOTES} notes, ${N_NOTES} embeddings…`);
  const owner = await User.create({ name: "Bench", email: `bench-${Date.now()}@x.dev`, passwordHash: await bcrypt.hash("x", 4), role: "admin" });
  const ownerId = owner._id;

  let done = timer();
  const contactDocs = Array.from({ length: N_CONTACTS }, (_, i) => ({
    _id: new Types.ObjectId(),
    name: `${pick(FIRST, i)} ${pick(LAST, i >> 4)}${i % 97 === 0 ? "" : ` ${i}`}`,
    email: `user${i}@${pick(CO, i >> 3).toLowerCase()}.com`,
    phone: `+1 555 ${String(1000 + (i % 9000)).padStart(4, "0")}`,
    company: pick(CO, i >> 3),
    tags: i % 3 === 0 ? ["enterprise"] : ["smb"],
    owner: ownerId,
    score: rand(100),
    lastActivityAt: new Date(Date.now() - rand(90) * 86_400_000),
    mergedInto: null,
  }));
  await Contact.insertMany(contactDocs, { ordered: false });
  record("seed contacts", done());

  done = timer();
  const dealDocs = Array.from({ length: N_DEALS }, (_, i) => ({
    _id: new Types.ObjectId(),
    title: `${pick(CO, i >> 3)} deal ${i}`,
    contact: contactDocs[i % N_CONTACTS]._id,
    value: 1000 + rand(200_000),
    stage: PIPELINE_STAGES[rand(PIPELINE_STAGES.length)] as Stage,
    owner: ownerId,
    expectedCloseDate: new Date(Date.now() + (rand(120) - 30) * 86_400_000),
    stageEnteredAt: new Date(Date.now() - rand(60) * 86_400_000),
    lastActivityAt: new Date(Date.now() - rand(60) * 86_400_000),
    score: rand(100),
    risk: rand(4) === 0 ? { atRisk: true, signals: ["stalled"], reasons: ["bench"], aiReason: "bench", suggestedAction: null, reasonSource: "template", flaggedAt: new Date().toISOString(), checkedAt: new Date().toISOString() } : null,
  }));
  await Deal.insertMany(dealDocs, { ordered: false });
  record("seed deals", done());

  done = timer();
  const noteDocs = Array.from({ length: N_NOTES }, (_, i) => ({
    _id: new Types.ObjectId(),
    kind: "note",
    content: `Note ${i}: the customer raised a concern about pricing and the budget line for ${pick(CO, i >> 3)}.`,
    deal: dealDocs[i % N_DEALS]._id,
    contact: contactDocs[i % N_CONTACTS]._id,
    owner: ownerId,
    sentiment: { score: Math.random() * 2 - 1, label: "neutral", source: "lexicon" },
    embeddingStatus: "done",
  }));
  await Note.insertMany(noteDocs, { ordered: false });
  record("seed notes", done());

  done = timer();
  await NoteEmbedding.insertMany(
    noteDocs.map((n) => ({ note: n._id, model: "bench", dims: DIMS, vec: packVector(unitVector()), owner: ownerId, deal: n.deal, contact: n.contact })),
    { ordered: false },
  );
  record("seed embeddings", done());

  console.log(`\nHot paths at ${N_CONTACTS} contacts / ${N_DEALS} deals / ${N_NOTES} notes:`);

  // 1. Vector search: the Mongo store loads every vector and ranks in process.
  done = timer();
  const rows = await NoteEmbedding.find({ model: "bench" }).select("note owner vec").lean();
  const loadMs = done();
  done = timer();
  const probe = unitVector();
  const ranked = rows.map((r) => ({ id: String(r.note), score: cosine(probe, unpackVector((r as any).vec) ?? []) })).sort((a, b) => b.score - a.score).slice(0, 10);
  const rankMs = done();
  record("semantic search: load vectors from Mongo", loadMs, `${rows.length} vectors`);
  record("semantic search: cosine + sort in process", rankMs, `top hit ${ranked[0]?.score.toFixed(3)}`);
  record("semantic search: TOTAL", loadMs + rankMs, "grows linearly with note count");

  // 2. Duplicate scan: old full cross join vs. blocking-key candidate generation.
  const dupSample = Math.min(N_CONTACTS, 1200);
  const sample = contactDocs.slice(0, dupSample).map((c) => ({ id: String(c._id), name: c.name, email: c.email, phone: c.phone, company: c.company }));

  done = timer();
  let pairs = 0;
  let flaggedNaive = 0;
  for (let i = 0; i < sample.length; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      pairs++;
      if (scorePair(sample[i], sample[j]).score >= 0.6) flaggedNaive++;
    }
  }
  const naiveMs = done();
  const perPair = naiveMs / pairs;
  record("duplicate scan BEFORE (full cross join)", naiveMs, `${dupSample} contacts = ${pairs.toLocaleString()} pairs`);
  record("  → BEFORE extrapolated to 10k contacts", (perPair * (10000 * 9999)) / 2, "O(n²)");

  done = timer();
  const blocked = candidatePairs(sample);
  const blockMs = done();
  done = timer();
  let flaggedBlocked = 0;
  for (const [a, b] of blocked) if (scorePair(a, b).score >= 0.6) flaggedBlocked++;
  const scoreMs = done();
  record("duplicate scan AFTER (blocking keys)", blockMs + scoreMs, `${blocked.length.toLocaleString()} pairs scored (${((blocked.length / pairs) * 100).toFixed(2)}% of cross join)`);
  record("  → AFTER speed-up", naiveMs / Math.max(0.001, blockMs + scoreMs), `× faster · recall ${flaggedNaive ? ((flaggedBlocked / flaggedNaive) * 100).toFixed(1) : "100.0"}% of ${flaggedNaive} duplicates found`);

  // 3. Full-scan duplicate detection at the real contact count, using blocking.
  const all = contactDocs.map((c) => ({ id: String(c._id), name: c.name, email: c.email, phone: c.phone, company: c.company }));
  done = timer();
  const allPairs = candidatePairs(all);
  for (const [a, b] of allPairs) scorePair(a, b);
  record(`duplicate scan AFTER, all ${N_CONTACTS} contacts`, done(), `${allPairs.length.toLocaleString()} pairs vs ${((N_CONTACTS * (N_CONTACTS - 1)) / 2).toLocaleString()} cross join`);

  /*
   * Recall on realistic duplicates. The synthetic contacts above share names and
   * companies by construction, so "duplicates found" among them measures noise,
   * not accuracy. Here we plant the error classes that actually occur in a CRM and
   * check the blocked candidate set still contains each planted pair.
   */
  const planted: Array<{ label: string; a: ContactLike; b: ContactLike }> = [
    {
      label: "typo in email local part",
      a: { id: "p1a", name: "Elizabeth Turner", email: "liz.turner@globex.io", phone: "+44 20 7946 0312", company: "Globex Corporation" },
      b: { id: "p1b", name: "Liz Turner", email: "liz.turnr@globex.io", phone: null, company: "Globex" },
    },
    {
      label: "typo in email domain",
      a: { id: "p2a", name: "Robert Chen", email: "robert.chen@northwind.com", phone: "+1 415 555 0142", company: "Northwind Traders" },
      b: { id: "p2b", name: "Bob Chen", email: "robert.chen@northwnd.com", phone: "(415) 555-0142", company: "Northwind Traders" },
    },
    {
      label: "no email, phone reformatted",
      a: { id: "p3a", name: "Priya Natarajan", email: "priya@initech.com", phone: "+1 512 555 0199", company: "Initech Inc" },
      b: { id: "p3b", name: "Natarajan, Priya", email: null, phone: "512-555-0199", company: "Initech" },
    },
    {
      label: "nickname, different email, same company",
      a: { id: "p4a", name: "William Hayes", email: "william.hayes@acme.com", phone: null, company: "Acme Corp" },
      b: { id: "p4b", name: "Bill Hayes", email: "bhayes@acme.com", phone: null, company: "Acme" },
    },
    {
      label: "name order swapped, same email",
      a: { id: "p5a", name: "Nina Sharp", email: "nsharp@massivedynamic.com", phone: null, company: "Massive Dynamic" },
      b: { id: "p5b", name: "Sharp, Nina", email: "nsharp@massivedynamic.com", phone: null, company: "Massive Dynamic" },
    },
  ];
  const withPlanted: ContactLike[] = [...all, ...planted.flatMap((p) => [p.a, p.b])];
  const plantedPairs = new Set(candidatePairs(withPlanted).map(([a, b]) => [a.id, b.id].sort().join(":")));
  console.log("\nRecall on realistic duplicate patterns (blocking must not drop these):");
  let recovered = 0;
  for (const p of planted) {
    const key = [p.a.id, p.b.id].sort().join(":");
    const inBlock = plantedPairs.has(key);
    const scored = scorePair(p.a, p.b).score;
    const caught = inBlock && scored >= 0.6;
    if (caught) recovered += 1;
    console.log(`  ${caught ? "found " : "MISSED"}  ${p.label.padEnd(38)} block=${inBlock ? "yes" : "no "} score=${scored.toFixed(2)}`);
  }
  console.log(`  → ${recovered}/${planted.length} realistic duplicates recovered after blocking`);

  // 3. Dashboard aggregation.
  done = timer();
  await Deal.aggregate([{ $match: { owner: ownerId } }, { $group: { _id: "$stage", count: { $sum: 1 }, value: { $sum: "$value" } } }]);
  record("dashboard: pipeline aggregation", done());

  done = timer();
  await Promise.all([
    Deal.countDocuments({ owner: ownerId, "risk.atRisk": true, stage: { $in: OPEN_STAGES } }),
    Deal.find({ owner: ownerId, "risk.atRisk": true, stage: { $in: OPEN_STAGES } }).sort({ value: -1 }).limit(10).lean(),
    Deal.find({ owner: ownerId, stage: { $in: OPEN_STAGES } }).sort({ score: -1 }).limit(5).lean(),
    Note.find({ owner: ownerId, kind: { $ne: "system" } }).sort({ createdAt: -1 }).limit(8).lean(),
  ]);
  record("dashboard: remaining queries", done());

  // 4. List queries.
  done = timer();
  await Deal.find({ owner: ownerId }).sort({ score: -1, _id: 1 }).limit(25).populate("contact", "name company email").populate("owner", "name email role").lean();
  record("deals list page 1 (sorted by score)", done());

  done = timer();
  await Deal.find({ owner: ownerId }).sort({ score: -1, _id: 1 }).skip(Math.max(0, N_DEALS - 50)).limit(25).lean();
  record("deals list deep page (skip near end)", done(), "skip/limit cost grows with offset");

  done = timer();
  const re = new RegExp("Globex", "i");
  const matched = await Contact.find({ $or: [{ name: re }, { company: re }] }).select("_id").lean();
  await Deal.find({ owner: ownerId, $or: [{ title: re }, { contact: { $in: matched.map((c) => c._id) } }] }).limit(25).lean();
  record("deals search by contact/company (regex)", done(), `${matched.length} contacts matched, unindexed regex`);

  done = timer();
  await Note.find({ $text: { $search: "pricing budget" }, owner: ownerId }, { score: { $meta: "textScore" } }).sort({ score: { $meta: "textScore" } }).limit(10).lean();
  record("note text search ($text index)", done());

  console.log("\nSlowest first:");
  for (const r of [...results].filter((r) => !r.op.startsWith("seed")).sort((a, b) => b.ms - a.ms).slice(0, 6)) {
    console.log(`  ${r.ms.toFixed(1).padStart(10)} ms  ${r.op}`);
  }

  await mongoose.connection.dropDatabase();
  await db.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
