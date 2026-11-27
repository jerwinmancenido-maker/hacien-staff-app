import { describe, expect, it } from "vitest";
import {
  duplicateWarningMessage,
  findNearNameMatches,
  isNearName,
  normalizeName,
  type NameMatch,
} from "../src/lib/duplicates";

// Finding 1364 (run 98): near-duplicate master records saved with NO warning.
// These tests pin the shared matcher (lib/duplicates) against the three
// run-98 cases plus the false-positive guards — legitimate near-names must
// still be creatable after one confirm, and unrelated names must never warn.

describe("normalizeName", () => {
  it("folds case, punctuation, spacing and diacritics", () => {
    expect(normalizeName("  Juan   Dela-Cruz,  Trading ")).toBe("juan dela cruz trading");
    expect(normalizeName("Señor Supplies, Inc.")).toBe("senor supplies inc");
    expect(normalizeName("Metro IT Parts")).toBe("metro it parts");
  });
});

describe("isNearName — the run-98 cases warn", () => {
  it("customer typo: 'Juan Dela Cruz Tradng' vs 'Juan Dela Cruz Trading'", () => {
    expect(isNearName("Juan Dela Cruz Tradng", "Juan Dela Cruz Trading")).toBe(true);
  });
  it("supplier truncation: 'Metro IT Part' vs 'Metro IT Parts'", () => {
    expect(isNearName("Metro IT Part", "Metro IT Parts")).toBe(true);
  });
  it("product exact name under a new SKU", () => {
    expect(isNearName("TEST Product Alpha 20261108", "TEST Product Alpha 20261108")).toBe(true);
  });
  it("case/punctuation variants of the same name", () => {
    expect(isNearName("metro it parts!", "Metro IT Parts")).toBe(true);
    expect(isNearName("ACME  Corp.", "Acme Corp")).toBe(true);
  });
  it("one missing trailing word (token subset)", () => {
    expect(isNearName("Dela Cruz Trading", "Juan Dela Cruz Trading")).toBe(true);
  });
});

describe("isNearName — legitimate different names do NOT warn", () => {
  it("different product variant word", () => {
    expect(isNearName("TEST Product Alpha 20261108", "TEST Product Beta 20261108")).toBe(false);
  });
  it("different companies sharing a generic word", () => {
    expect(isNearName("Metro Office Supplies", "Metro IT Parts")).toBe(false);
    expect(isNearName("Sunrise Trading", "Juan Dela Cruz Trading")).toBe(false);
  });
  it("short names far apart", () => {
    expect(isNearName("ABC", "XYZ")).toBe(false);
  });
});

describe("findNearNameMatches", () => {
  const existing: NameMatch[] = [
    { id: "1", name: "Juan Dela Cruz Trading", active: true },
    { id: "2", name: "Metro IT Parts", active: true },
    { id: "3", name: "Old Trading Co", active: false },
  ];
  it("returns the near match, exact first, capped", () => {
    const m = findNearNameMatches(existing, "Juan Dela Cruz Tradng");
    expect(m.map((x) => x.id)).toEqual(["1"]);
    const exact = findNearNameMatches(existing, "Metro IT Parts");
    expect(exact[0]?.name).toBe("Metro IT Parts");
  });
  it("excludes the record being edited", () => {
    expect(findNearNameMatches(existing, "Juan Dela Cruz Trading", "1")).toEqual([]);
  });
  it("no match for a genuinely new name", () => {
    expect(findNearNameMatches(existing, "Brand New Ventures")).toEqual([]);
  });
});

describe("duplicateWarningMessage", () => {
  it("names the existing record (legacy F38 wording for one match)", () => {
    const msg = duplicateWarningMessage("customer", [{ id: "1", name: "Juan Dela Cruz Trading", active: true }]);
    expect(msg).toContain('A customer named "Juan Dela Cruz Trading" already exists');
    expect(msg).toContain("save anyway");
  });
  it("marks inactive records and lists several matches", () => {
    const msg = duplicateWarningMessage("supplier", [
      { id: "1", name: "Metro IT Parts", active: true },
      { id: "2", name: "Metro IT Partz", active: false },
    ]);
    expect(msg).toContain('"Metro IT Parts"');
    expect(msg).toContain('"Metro IT Partz" (inactive)');
  });
});
