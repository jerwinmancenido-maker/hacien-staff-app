// ERP adoption item 15: the derived SO stage label. The stage is computed
// at render from status + the item-7 measures and never stored, so these
// tests pin the whole truth table: every reachable combination maps to
// exactly one label, precedence is the earliest incomplete step in the
// order's life (delivery → billing → payment), and no label may claim a
// state the measures contradict.

import { describe, expect, it } from "vitest";
import { salesOrderStage, type StageMeasures } from "@/lib/progress";

const m = (deliveredPct: number | null, billedPct: number | null, paidPct: number | null): StageMeasures => ({
  deliveredPct,
  billedPct,
  paidPct,
});

describe("salesOrderStage — status rows", () => {
  it("VOID has no stage — the VOID status stands alone, whatever the measures", () => {
    expect(salesOrderStage("VOID", m(0, 0, null))).toBeNull();
    expect(salesOrderStage("VOID", m(100, 100, 100))).toBeNull();
    expect(salesOrderStage("VOID", m(null, null, null))).toBeNull();
  });

  it("CLOSED reads Closed — the deliberate status wins over leftover measures", () => {
    expect(salesOrderStage("CLOSED", m(100, 100, 100))).toBe("Closed");
    expect(salesOrderStage("CLOSED", m(40, 0, null))).toBe("Closed");
    expect(salesOrderStage("CLOSED", m(null, null, null))).toBe("Closed");
  });
});

describe("salesOrderStage — the delivery step comes first", () => {
  it("nothing delivered yet → Not yet delivered, even when prepaid in full", () => {
    expect(salesOrderStage("OPEN", m(0, 0, null))).toBe("Not yet delivered");
    expect(salesOrderStage("OPEN", m(0, 100, 100))).toBe("Not yet delivered");
  });

  it("some delivered → Part-delivered, even when billed and paid in full", () => {
    expect(salesOrderStage("OPEN", m(40, 0, null))).toBe("Part-delivered");
    expect(salesOrderStage("OPEN", m(99.99, 100, 100))).toBe("Part-delivered");
  });

  it("over-delivery (over 100) counts as delivered and moves on", () => {
    expect(salesOrderStage("OPEN", m(120, 0, null))).toBe("Delivered, not yet billed");
  });
});

describe("salesOrderStage — the billing step", () => {
  it("delivered in full, nothing billed → Delivered, not yet billed", () => {
    expect(salesOrderStage("OPEN", m(100, 0, null))).toBe("Delivered, not yet billed");
  });

  it("no live lines, nothing billed → Not yet billed (no delivery was owed)", () => {
    expect(salesOrderStage("OPEN", m(null, 0, null))).toBe("Not yet billed");
  });

  it("part-billed → Part-billed, before any payment question", () => {
    expect(salesOrderStage("OPEN", m(100, 40, 0))).toBe("Part-billed");
    expect(salesOrderStage("OPEN", m(null, 40, 75))).toBe("Part-billed");
  });

  it("over-billing (over 100) counts as billed and moves on", () => {
    expect(salesOrderStage("OPEN", m(100, 103.85, 50))).toBe("Part-paid");
  });
});

describe("salesOrderStage — the payment step", () => {
  it("fully billed, nothing paid → Billed, awaiting payment", () => {
    expect(salesOrderStage("OPEN", m(100, 100, 0))).toBe("Billed, awaiting payment");
    expect(salesOrderStage("OPEN", m(null, 100, 0))).toBe("Billed, awaiting payment");
  });

  it("part-paid → Part-paid", () => {
    expect(salesOrderStage("OPEN", m(100, 100, 45))).toBe("Part-paid");
  });

  it("paid in full only when the paid measure is truly complete", () => {
    expect(salesOrderStage("OPEN", m(100, 100, 100))).toBe("Paid in full");
    expect(salesOrderStage("OPEN", m(100, 100, 99.99))).toBe("Part-paid");
  });

  it("over-payment (over 100) is still Paid in full — the bars keep the true number", () => {
    expect(salesOrderStage("OPEN", m(100, 100, 120))).toBe("Paid in full");
  });
});

describe("salesOrderStage — the no-billing corners", () => {
  it("a ₱0 order (billed has no base) fully delivered → Fully delivered", () => {
    expect(salesOrderStage("OPEN", m(100, null, null))).toBe("Fully delivered");
  });

  it("no live lines and a ₱0 total → Nothing outstanding", () => {
    expect(salesOrderStage("OPEN", m(null, null, null))).toBe("Nothing outstanding");
  });

  it("no live lines but billed and paid → Paid in full", () => {
    expect(salesOrderStage("OPEN", m(null, 100, 100))).toBe("Paid in full");
  });
});

describe("salesOrderStage — whole-grid invariants", () => {
  const values: (number | null)[] = [null, 0, 50, 100, 110];

  it("every OPEN combination yields exactly one stage (never null, deterministic)", () => {
    for (const d of values)
      for (const b of values)
        for (const p of values) {
          const stage = salesOrderStage("OPEN", m(d, b, p));
          expect(stage).not.toBeNull();
          expect(salesOrderStage("OPEN", m(d, b, p))).toBe(stage);
        }
  });

  it("no label ever claims a state the measures contradict", () => {
    for (const d of values)
      for (const b of values)
        for (const p of values) {
          const stage = salesOrderStage("OPEN", m(d, b, p));
          if (stage === "Paid in full") expect(p !== null && p >= 100).toBe(true);
          if (stage === "Not yet delivered") expect(d).toBe(0);
          if (stage === "Part-delivered") expect(d !== null && d > 0 && d < 100).toBe(true);
          if (stage === "Delivered, not yet billed") {
            expect(d !== null && d >= 100).toBe(true);
            expect(b).toBe(0);
          }
          if (stage === "Part-billed") expect(b !== null && b > 0 && b < 100).toBe(true);
          if (stage === "Billed, awaiting payment") expect(p).toBe(0);
          if (stage === "Part-paid") expect(p !== null && p > 0 && p < 100).toBe(true);
        }
  });
});
