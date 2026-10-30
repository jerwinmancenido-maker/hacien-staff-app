import { describe, expect, it } from "vitest";
import { approvalReasons, docTotals, fromScaled, lineAmounts, pctToRate, ratePctLabel, toScaled, type WithholdingSnapshot } from "@/lib/quotes/calc";
import { planItems } from "@/lib/quotes/items";
import { buildWithholdingSnapshot } from "@/lib/services/withholding";
import { formatDocNumber, seriesYear } from "@/lib/documents/series";
import { Prisma } from "@prisma/client";

const rate = (code: string, lineKind: WithholdingSnapshot["lineKind"], r: string): WithholdingSnapshot => ({ code, label: code, lineKind, rate: r, atcCode: null });
const GOODS_1 = rate("GOODS_1", "GOODS", "0.0100");
const SERVICES_2 = rate("SERVICES_2", "SERVICES", "0.0200");
const GOV_PT_3 = rate("GOV_PT_3", "GOV_PT", "0.0300");
const GOV_VAT_5 = rate("GOV_VAT_5", "GOV_VAT", "0.0500");

describe("decimal helpers", () => {
  it("parses and formats exactly, rounding half-up", () => {
    expect(toScaled("1,234.5", 2)).toBe(123450n);
    expect(toScaled("0.005", 2)).toBe(1n);
    expect(toScaled("0.004", 2)).toBe(0n);
    expect(toScaled("-1.005", 2)).toBe(-101n);
    expect(fromScaled(123450n, 2)).toBe("1234.50");
    expect(fromScaled(5n, 2)).toBe("0.05");
    expect(fromScaled(-5n, 2)).toBe("-0.05");
    expect(() => toScaled("abc", 2)).toThrow();
  });

  it("converts rate percents both ways", () => {
    expect(pctToRate("1")).toBe("0.0100");
    expect(pctToRate("1.5")).toBe("0.0150");
    expect(ratePctLabel("0.0100")).toBe("1%");
    expect(ratePctLabel("0.0150")).toBe("1.5%");
  });
});

describe("line amounts", () => {
  it("total = qty × HACIEN unit price; supplier total = supplier unit × buyer qty; margin = difference", () => {
    expect(lineAmounts({ kind: "GOODS", qty: "10", unitPrice: "52000", supplierUnitCost: "45000" })).toEqual({
      total: "520000.00",
      supplierTotal: "450000.00",
      margin: "70000.00",
    });
  });

  it("rounds each line to 2 decimals", () => {
    // 3 × 33.335 isn't possible (2 dp prices) but 1.5 × 10.01 = 15.015 → 15.02
    expect(lineAmounts({ kind: "GOODS", qty: "1.5", unitPrice: "10.01", supplierUnitCost: "3.33" })).toEqual({
      total: "15.02",
      supplierTotal: "5.00", // 4.995 → 5.00
      margin: "10.02",
    });
    // No float drift: 0.1 × 3 = 0.30 exactly
    expect(lineAmounts({ kind: "GOODS", qty: "3", unitPrice: "0.10", supplierUnitCost: "0" }).total).toBe("0.30");
  });
});

describe("document totals", () => {
  const lines = [
    { kind: "GOODS" as const, qty: "10", unitPrice: "52000", supplierUnitCost: "45000" },
    { kind: "SERVICES" as const, qty: "1", unitPrice: "20000", supplierUnitCost: "5000" },
  ];

  it("applies goods rates to goods lines, services rates to services lines and gov rates to the total", () => {
    const t = docTotals(lines, [GOODS_1, SERVICES_2, GOV_PT_3, GOV_VAT_5]);
    expect(t.contractPrice).toBe("540000.00");
    expect(t.withholding.map((w) => [w.code, w.base, w.amount])).toEqual([
      ["GOODS_1", "520000.00", "5200.00"],
      ["SERVICES_2", "20000.00", "400.00"],
      ["GOV_PT_3", "540000.00", "16200.00"],
      ["GOV_VAT_5", "540000.00", "27000.00"],
    ]);
    expect(t.withholdingTotal).toBe("48800.00");
    expect(t.netReceived).toBe("491200.00");
    expect(t.supplierCost).toBe("455000.00");
    expect(t.netMargin).toBe("36200.00");
    expect(t.netMarginPct).toBe("6.70"); // 36,200 / 540,000
  });

  it("uses the gross contract price as the base (non-VAT: never ÷ 1.12)", () => {
    const t = docTotals([{ kind: "GOODS", qty: "1", unitPrice: "112000", supplierUnitCost: "0" }], [GOODS_1]);
    expect(t.withholding[0]?.base).toBe("112000.00");
    expect(t.withholdingTotal).toBe("1120.00");
  });

  it("with no withholding, net received = contract price", () => {
    const t = docTotals(lines, []);
    expect(t.netReceived).toBe(t.contractPrice);
    expect(t.netMargin).toBe("85000.00");
    expect(t.netMarginPct).toBe("15.74");
  });

  it("rounds each withholding amount to 2 decimals", () => {
    const t = docTotals([{ kind: "GOODS", qty: "1", unitPrice: "100.50", supplierUnitCost: "0" }], [GOODS_1, GOV_PT_3]);
    // 1.005 → 1.01 ; 3.015 → 3.02
    expect(t.withholding.map((w) => w.amount)).toEqual(["1.01", "3.02"]);
    expect(t.withholdingTotal).toBe("4.03");
    expect(t.netReceived).toBe("96.47");
  });

  it("handles an empty quote and negative margins", () => {
    expect(docTotals([], [GOODS_1]).netMarginPct).toBe("0.00");
    const t = docTotals([{ kind: "GOODS", qty: "1", unitPrice: "100", supplierUnitCost: "150" }], []);
    expect(t.netMargin).toBe("-50.00");
    expect(t.netMarginPct).toBe("-50.00");
  });

  it("matches the design brief example (₱510,000 / ₱450,000 → 11.76%)", () => {
    const t = docTotals([{ kind: "GOODS", qty: "1", unitPrice: "510000", supplierUnitCost: "450000" }], []);
    expect(t.netMargin).toBe("60000.00");
    expect(t.netMarginPct).toBe("11.76");
  });
});

describe("approval flag", () => {
  const approval = { marginBelowPct: 18, totalAbove: 500_000 };
  it("flags low margin and big totals", () => {
    expect(approvalReasons({ contractPrice: "540000.00", netMarginPct: "11.78" }, approval)).toHaveLength(2);
    expect(approvalReasons({ contractPrice: "100000.00", netMarginPct: "18.00" }, approval)).toEqual([]);
    expect(approvalReasons({ contractPrice: "500000.00", netMarginPct: "17.99" }, approval)).toEqual(["Margin is below 18%"]);
  });
});

describe("withholding snapshot", () => {
  const current = [
    { code: "GOODS_1", label: "Goods 1%", lineKind: "GOODS" as const, rate: new Prisma.Decimal("0.015"), atcCode: null, active: true, sortOrder: 1 },
    { code: "GOV_PT_3", label: "Gov PT 3%", lineKind: "GOV_PT" as const, rate: new Prisma.Decimal("0.03"), atcCode: null, active: true, sortOrder: 3 },
    { code: "OLD", label: "Old", lineKind: "GOODS" as const, rate: new Prisma.Decimal("0.02"), atcCode: null, active: false, sortOrder: 2 },
  ];

  it("keeps the values already on the document and snapshots new codes from Settings", () => {
    const snap = buildWithholdingSnapshot(["GOV_PT_3", "GOODS_1"], current, [GOODS_1]);
    expect(snap).toEqual([GOODS_1, { code: "GOV_PT_3", label: "Gov PT 3%", lineKind: "GOV_PT", rate: "0.0300", atcCode: null }]);
  });

  it("rejects inactive or unknown new codes, or skips them when copying a customer default", () => {
    expect(() => buildWithholdingSnapshot(["OLD"], current)).toThrow(/isn't available/);
    expect(buildWithholdingSnapshot(["OLD", "NOPE", "GOODS_1"], current, [], { skipUnknown: true }).map((s) => s.code)).toEqual(["GOODS_1"]);
  });
});

describe("item planning", () => {
  const existing = [{ id: "a", kind: "GOODS" as const, supplierId: "sup1", supplierUnitCost: "45000.00" }];
  const input = { id: "a", description: "Laptop", kind: "GOODS" as const, qty: "2", unit: "pc", supplierId: null, supplierUnitCost: "0", unitPrice: "52000" };

  it("keeps existing costs for users who can't see them", () => {
    const { items, removedIds } = planItems(existing, [input, { ...input, id: null, supplierId: "sup9", supplierUnitCost: "1" }], false);
    expect(items[0]).toMatchObject({ id: "a", supplierId: "sup1", supplierUnitCost: "45000.00", supplierTotal: "90000.00", total: "104000.00" });
    expect(items[1]).toMatchObject({ id: null, supplierId: null, supplierUnitCost: "0", supplierTotal: "0.00" });
    expect(removedIds).toEqual([]);
  });

  it("takes costs from cost users and reports removed rows", () => {
    const { items, removedIds } = planItems(existing, [{ ...input, id: "zzz", supplierId: "sup2", supplierUnitCost: "40000" }], true);
    expect(items[0]).toMatchObject({ id: null, supplierId: "sup2", supplierTotal: "80000.00", margin: "24000.00" });
    expect(removedIds).toEqual(["a"]);
  });
});

describe("number format", () => {
  it("formats QT/SO numbers and picks the counter year", () => {
    expect(formatDocNumber({ prefix: "QT", padding: 4 }, 2026, 1)).toBe("QT-2026-0001");
    expect(formatDocNumber({ prefix: "SO", padding: 4 }, 2026, 12345)).toBe("SO-2026-12345");
    expect(seriesYear({ prefix: "QT", padding: 4, resetYearly: true }, 2027)).toBe(2027);
    expect(seriesYear({ prefix: "QT", padding: 4, resetYearly: false }, 2027)).toBe(0);
  });
});
