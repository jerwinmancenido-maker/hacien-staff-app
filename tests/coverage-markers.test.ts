// Markers pairs 3 + 4 — pure coverage notes + wiring pins. Billing coverage
// (vs SO) and receiving coverage (vs PO) in neutral words; partial states
// are normal, never errors.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { billingCoverageNote, billingPositionNote, receivingCoverageNote } from "@/lib/billing/coverage";

describe("billingCoverageNote", () => {
  it("partial billing states what is left, neutrally", () => {
    expect(billingCoverageNote({ billedTotal: "400000.00", contractPrice: "598000.00" })).toBe(
      "Part of this order — billed ₱400000.00 of ₱598000.00 · ₱198000.00 left to bill.",
    );
  });

  it("fully billed says so", () => {
    expect(billingCoverageNote({ billedTotal: "598000.00", contractPrice: "598000.00" })).toBe(
      "Fully billed — ₱598000.00 of ₱598000.00 on this order.",
    );
  });

  it("position only exists with siblings", () => {
    expect(billingPositionNote(0, 1)).toBeNull();
    expect(billingPositionNote(1, 3)).toBe("Billing 2 of 3 on this order.");
  });
});

describe("receivingCoverageNote", () => {
  it("nothing received yet → no note", () => {
    expect(receivingCoverageNote({ orderedQty: "10.00", receivedQty: "0.00", unit: "pc" })).toBeNull();
  });

  it("short, full and over read plainly", () => {
    expect(receivingCoverageNote({ orderedQty: "10.00", receivedQty: "8.00", unit: "pc" })).toBe("Received 8.00 of 10.00 pc · 2.00 still to come.");
    expect(receivingCoverageNote({ orderedQty: "10.00", receivedQty: "10.00", unit: "pc" })).toBe("Fully received — 10.00 of 10.00 pc.");
    expect(receivingCoverageNote({ orderedQty: "10.00", receivedQty: "12.00", unit: "pc" })).toBe("Received 12.00 of 10.00 pc — 2.00 more than ordered.");
  });
});

describe("wiring", () => {
  it("billing view + page carry the coverage note", () => {
    const views = readFileSync("src/lib/billing/views.ts", "utf8");
    expect(views).toContain("billingCoverageNote");
    expect(views).toContain("billingCoverage,");
    const page = readFileSync("src/app/(app)/billing/billings/[id]/page.tsx", "utf8");
    expect(page).toContain("b.billingCoverage.note");
  });

  it("receiving view + page carry the per-line coverage note", () => {
    const views = readFileSync("src/lib/purchasing/views.ts", "utf8");
    expect(views).toContain("coverageNote: receivingCoverageNote");
    const page = readFileSync("src/app/(app)/receiving/[poId]/page.tsx", "utf8");
    expect(page).toContain("l.coverageNote");
  });
});
