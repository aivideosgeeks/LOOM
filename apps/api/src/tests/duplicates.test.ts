import { describe, expect, it } from "vitest";
import { blockingKeys, candidatePairs, DUPLICATE_THRESHOLD, nameSimilarity, scorePair, type ContactLike } from "../ai/features/duplicates";

describe("duplicate contact matching", () => {
  it("flags a typo'd email with the same name", () => {
    const r = scorePair(
      { id: "1", name: "Elizabeth Turner", email: "liz.turner@globex.io", company: "Globex Corporation" },
      { id: "2", name: "Liz Turner", email: "liz.turnr@globex.io", company: "Globex" },
    );
    expect(r.score).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
    expect(r.reasons.join(" ")).toMatch(/Email differs/);
  });

  it("flags a mistyped email domain", () => {
    const r = scorePair(
      { id: "1", name: "Robert Chen", email: "robert.chen@northwind.com", company: "Northwind Traders" },
      { id: "2", name: "Bob Chen", email: "robert.chen@northwnd.com", company: "Northwind Traders" },
    );
    expect(r.score).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
    expect(r.reasons).toEqual(expect.arrayContaining([expect.stringMatching(/domain/), "Same or equivalent name", "Same company"]));
  });

  it("flags same company + equivalent name + phone even without email", () => {
    const r = scorePair(
      { id: "1", name: "Priya Natarajan", email: "priya@initech.com", phone: "+1 512 555 0199", company: "Initech Inc" },
      { id: "2", name: "Natarajan, Priya", phone: "512-555-0199", company: "Initech" },
    );
    expect(r.score).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
    expect(r.reasons).toContain("Same phone number");
  });

  it("does not flag different people at the same company", () => {
    const r = scorePair(
      { id: "1", name: "Marcus Lee", email: "marcus.lee@umbrellahealth.com", company: "Umbrella Health" },
      { id: "2", name: "Dana Okafor", email: "dana.okafor@umbrellahealth.com", company: "Umbrella Health" },
    );
    expect(r.score).toBeLessThan(DUPLICATE_THRESHOLD);
  });

  it("does not flag similar names with clearly different emails and companies", () => {
    const r = scorePair(
      { id: "1", name: "John Smith", email: "john.smith@acme.com", company: "Acme" },
      { id: "2", name: "Jon Smith", email: "jsmith@globex.io", company: "Globex" },
    );
    expect(r.score).toBeLessThan(DUPLICATE_THRESHOLD);
  });

  it("understands nicknames and name order", () => {
    expect(nameSimilarity("Bob Chen", "Robert Chen")).toBeGreaterThanOrEqual(0.95);
    expect(nameSimilarity("Turner, Elizabeth", "Liz Turner")).toBeGreaterThanOrEqual(0.95);
    expect(nameSimilarity("Alice Wong", "Bob Chen")).toBeLessThan(0.7);
  });
});

/**
 * Blocking replaces the full cross join, so it must not silently drop real duplicates.
 * Each case below is an error class that actually occurs in a CRM.
 */
describe("duplicate blocking keys", () => {
  const REAL_PAIRS: Array<[string, ContactLike, ContactLike]> = [
    [
      "typo in the email local part",
      { id: "a", name: "Elizabeth Turner", email: "liz.turner@globex.io", phone: "+44 20 7946 0312", company: "Globex Corporation" },
      { id: "b", name: "Liz Turner", email: "liz.turnr@globex.io", company: "Globex" },
    ],
    [
      "typo in the email domain",
      { id: "c", name: "Robert Chen", email: "robert.chen@northwind.com", phone: "+1 415 555 0142", company: "Northwind Traders" },
      { id: "d", name: "Bob Chen", email: "robert.chen@northwnd.com", phone: "(415) 555-0142", company: "Northwind Traders" },
    ],
    [
      "no email on one side, phone reformatted",
      { id: "e", name: "Priya Natarajan", email: "priya@initech.com", phone: "+1 512 555 0199", company: "Initech Inc" },
      { id: "f", name: "Natarajan, Priya", phone: "512-555-0199", company: "Initech" },
    ],
    [
      "nickname with a different email at the same company",
      { id: "g", name: "William Hayes", email: "william.hayes@acme.com", company: "Acme Corp" },
      { id: "h", name: "Bill Hayes", email: "bhayes@acme.com", company: "Acme" },
    ],
    [
      "name order swapped, same email",
      { id: "i", name: "Nina Sharp", email: "nsharp@massivedynamic.com", company: "Massive Dynamic" },
      { id: "j", name: "Sharp, Nina", email: "nsharp@massivedynamic.com", company: "Massive Dynamic" },
    ],
  ];

  it.each(REAL_PAIRS)("keeps a candidate pair for %s", (_label, a, b) => {
    const shared = blockingKeys(a).filter((k) => blockingKeys(b).includes(k));
    expect(shared.length).toBeGreaterThan(0);
    const pairs = candidatePairs([a, b]);
    expect(pairs).toHaveLength(1);
    expect(scorePair(a, b).score).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
  });

  it("does not pair two different people at the same company", () => {
    const marcus: ContactLike = { id: "m", name: "Marcus Lee", email: "marcus.lee@umbrellahealth.com", company: "Umbrella Health" };
    const dana: ContactLike = { id: "d", name: "Dana Okafor", email: "dana.okafor@umbrellahealth.com", company: "Umbrella Health" };
    expect(candidatePairs([marcus, dana])).toHaveLength(0);
  });

  it("compares far fewer pairs than a full cross join", () => {
    const contacts: ContactLike[] = Array.from({ length: 400 }, (_, i) => ({
      id: `c${i}`,
      name: `Person ${i} Surname${i % 40}`,
      email: `person${i}@company${i % 20}.com`,
      phone: `+1 555 ${String(1000 + i).padStart(4, "0")}`,
      company: `Company ${i % 20}`,
    }));
    const crossJoin = (contacts.length * (contacts.length - 1)) / 2;
    const pairs = candidatePairs(contacts);
    expect(pairs.length).toBeLessThan(crossJoin * 0.1);
  });

  it("skips keys shared by too many records to carry signal", () => {
    // 200 people at one company must not become a 19,900-pair block.
    const contacts: ContactLike[] = Array.from({ length: 200 }, (_, i) => ({
      id: `x${i}`,
      name: `Unique${i} Distinct${i}`,
      email: `u${i}@bigcorp.com`,
      company: "BigCorp",
    }));
    expect(candidatePairs(contacts)).toHaveLength(0);
  });
});
