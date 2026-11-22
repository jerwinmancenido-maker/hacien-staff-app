import { describe, expect, it } from "vitest";
import {
  isNameLikeCustomerQuery,
  rankCustomerNameSuggestions,
  type CustomerNameCandidate,
} from "@/lib/search/suggest-customers";

// L25 Fix B: the pure "Did you mean" scorer. DB wrapper lives in
// src/lib/services/companies.ts (suggestCustomersByName); these tests pin
// the ranking rules without a database.
const CANDIDATES: CustomerNameCandidate[] = [
  { id: "c1", name: "Juan Dela Cruz Trading" },
  { id: "c2", name: "HACIEN Information Technology Solutions" },
  { id: "c3", name: "Metro IT Parts" },
  { id: "c4", name: "Cruzada Enterprises" },
  { id: "c5", name: "Dela Cruz Hardware", active: false },
];

const ids = (q: string, cs: readonly CustomerNameCandidate[] = CANDIDATES) =>
  rankCustomerNameSuggestions(q, cs).map((s) => s.id);

describe("isNameLikeCustomerQuery", () => {
  it("accepts name-like queries", () => {
    expect(isNameLikeCustomerQuery("Dela Crus")).toBe(true);
    expect(isNameLikeCustomerQuery("Crus")).toBe(true);
    expect(isNameLikeCustomerQuery("Route 66 Diner")).toBe(true);
  });

  it("rejects short, digit-only and document-shaped queries", () => {
    expect(isNameLikeCustomerQuery("ab")).toBe(false);
    expect(isNameLikeCustomerQuery("0919")).toBe(false);
    expect(isNameLikeCustomerQuery("0919 111 2222")).toBe(false);
    expect(isNameLikeCustomerQuery("QT-2026-0012")).toBe(false);
    expect(isNameLikeCustomerQuery("SO-2026-0002")).toBe(false);
    expect(isNameLikeCustomerQuery("BL-2026-0007")).toBe(false);
  });
});

describe("rankCustomerNameSuggestions", () => {
  it("suggests the customer behind a one-letter spelling variant (layer case 4)", () => {
    expect(ids("Dela Crus")).toEqual(["c1"]);
    expect(rankCustomerNameSuggestions("Dela Crus", CANDIDATES)).toEqual([
      { id: "c1", name: "Juan Dela Cruz Trading" },
    ]);
  });

  it("matches tokens in any order and across multi-word names", () => {
    expect(ids("Crus Dela")).toEqual(["c1"]);
    expect(ids("Juan Tradng")).toEqual(["c1"]);
    expect(ids("Crus")).toEqual(["c1"]);
  });

  it("returns nothing for unrelated queries", () => {
    expect(ids("Zebra Xylophone")).toEqual([]);
    expect(ids("Abcdefghij")).toEqual([]);
  });

  it("never suggests for document-number-like queries", () => {
    expect(ids("QT-2026-0012")).toEqual([]);
    expect(ids("SO-2026-0002")).toEqual([]);
    expect(ids("0919 111 2222")).toEqual([]);
  });

  it("rejects distance 2 on a short token (≤5 chars allows only 1)", () => {
    // "Crs" is edit distance 2 from "Cruz" — outside the short-token budget.
    expect(ids("Crs")).toEqual([]);
  });

  it("accepts distance 2 on a long token (>5 chars allows 2)", () => {
    // Transposed letters: plain Levenshtein counts a swap as 2.
    expect(ids("Tradign")).toEqual(["c1"]);
    // Two substitutions on a 9-char token.
    expect(ids("Solushons")).toEqual(["c2"]);
  });

  it("excludes inactive customers even on an exact name", () => {
    expect(ids("Dela Cruz")).toEqual(["c1"]);
    expect(ids("Dela Cruz", [{ id: "i1", name: "Dela Cruz Hardware", active: false }])).toEqual([]);
  });

  it("ranks closer matches first", () => {
    const cs: CustomerNameCandidate[] = [
      { id: "x2", name: "Juan Dela Cruz Trading" },
      { id: "x1", name: "Dela Crus Builders" },
    ];
    expect(ids("Dela Crus", cs)).toEqual(["x1", "x2"]);
  });

  it("caps suggestions at 3, best-ranked first", () => {
    const cs: CustomerNameCandidate[] = [
      { id: "t5", name: "Gamma Trading Inc" },
      { id: "t3", name: "Delta Trading Corp" },
      { id: "t1", name: "Alpha Trading" },
      { id: "t4", name: "Epsilon Trading Ltd" },
      { id: "t2", name: "Beta Trading Co" },
    ];
    const out = rankCustomerNameSuggestions("Tradign", cs);
    expect(out).toHaveLength(3);
    expect(out.map((s) => s.id)).toEqual(["t1", "t2", "t3"]);
  });
});
