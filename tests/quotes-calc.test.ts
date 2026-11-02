import { describe, expect, it } from "vitest";
import { approvalReasons, COST_NOT_SET_LABEL, docTotals, fromScaled, lineAmounts, linesMissingSupplierCost, pctToRate, ratePctLabel, supplierCostStateFromSupplierTotals, toScaled, type WithholdingSnapshot } from "@/lib/quotes/calc";
import { planItems } from "@/lib/quotes/items";
import { buildWithholdingSnapshot } from "@/lib/services/withholding";
import { formatDocNumber, seriesYear } from "@/lib/documents/series";
import { Prisma } from "@prisma/client";

const rate = (code: string, lineKind: WithholdingSnapshot["lineKind"], r: string): WithholdingSnapshot => ({ code, label: code, lineKind, rate: r, atcCode: null });
const GOODS_1 = rate("GOODS_1", "GOODS", "0.0100");

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

describe("document totals (per-line rates)", () => {
  const lines = [
    { kind: "GOODS" as const, qty: "10", unitPrice: "52000", supplierUnitCost: "45000", withholdingRate: "0.0100", withholdingAtc: "WI158" },
    { kind: "SERVICES" as const, qty: "1", unitPrice: "20000", supplierUnitCost: "5000", withholdingRate: "0.0200", withholdingAtc: "WI160" },
  ];

  it("mixed document: goods at 1% plus services at 2% totals correctly", () => {
    const t = docTotals(lines);
    expect(t.contractPrice).toBe("540000.00");
    // 520000×1% = 5200; 20000×2% = 400
    expect(t.withholding.map((w) => [w.code, w.base, w.amount])).toEqual([
      ["GOODS_1", "520000.00", "5200.00"],
      ["SERVICES_2", "20000.00", "400.00"],
    ]);
    expect(t.withholdingTotal).toBe("5600.00");
    expect(t.netReceived).toBe("534400.00");
    expect(t.supplierCost).toBe("455000.00");
    // Margin = contract − supplier (WH is a tax credit, not a cost).
    expect(t.netMargin).toBe("85000.00");
    expect(t.netMarginPct).toBe("15.74");
  });

  it("rounds withholding per line to the centavo (half-up), then sums", () => {
    // 100.50 × 1% = 1.005 → 1.01; 100.50 × 3% = 3.015 → 3.02
    const t = docTotals([
      { kind: "GOODS", qty: "1", unitPrice: "100.50", supplierUnitCost: "0", withholdingRate: "0.0100", withholdingAtc: "WI158" },
      { kind: "SERVICES", qty: "1", unitPrice: "100.50", supplierUnitCost: "0", withholdingRate: "0.0300", withholdingAtc: "WB080" },
    ]);
    expect(t.withholding.map((w) => w.amount)).toEqual(["1.01", "3.02"]);
    expect(t.withholdingTotal).toBe("4.03");
    expect(t.netReceived).toBe("196.97"); // 201.00 − 4.03
  });

  it("uses the gross line total as the base (non-VAT: never ÷ 1.12)", () => {
    const t = docTotals([{ kind: "GOODS", qty: "1", unitPrice: "112000", supplierUnitCost: "0", withholdingRate: "0.0100", withholdingAtc: "WI158" }]);
    expect(t.withholding[0]?.base).toBe("112000.00");
    expect(t.withholdingTotal).toBe("1120.00");
  });

  it("null/blank line rates contribute ₱0 (legacy unsapped rows)", () => {
    const t = docTotals([
      { kind: "GOODS", qty: "10", unitPrice: "52000", supplierUnitCost: "45000", withholdingRate: null },
      { kind: "SERVICES", qty: "1", unitPrice: "20000", supplierUnitCost: "5000" },
    ]);
    expect(t.withholdingTotal).toBe("0.00");
    expect(t.netReceived).toBe(t.contractPrice);
  });

  it("WV050 is not the 5% VAT alias group; WG010 stays a legacy WB080 alias", () => {
    // WV050 = 12% VAT on non-residents — must never map to GOV_VAT_5 / WV010/WV020.
    const wv050 = docTotals([
      { kind: "GOODS", qty: "1", unitPrice: "100000", supplierUnitCost: "0", withholdingRate: "0.1200", withholdingAtc: "WV050" },
    ]);
    expect(wv050.withholding).toHaveLength(1);
    expect(wv050.withholding[0]?.code).not.toBe("GOV_VAT_5");
    expect(wv050.withholding[0]?.label).toBe("VAT (non-resident) 12% (WV050)");
    expect(wv050.withholding[0]?.label).not.toMatch(/WV010\/WV020/);
    expect(wv050.withholdingTotal).toBe("12000.00");

    // Even a mis-stored 5% + WV050 must not join the GOV_VAT_5 / WV010 group.
    const mislabeled = docTotals([
      { kind: "SERVICES", qty: "1", unitPrice: "10000", supplierUnitCost: "0", withholdingRate: "0.0500", withholdingAtc: "WV050" },
    ]);
    expect(mislabeled.withholding[0]?.code).not.toBe("GOV_VAT_5");
    expect(mislabeled.withholding[0]?.label).toBe("VAT (non-resident) 5% (WV050)");

    // Real 5% VAT withheld still uses WV010/WV020 only.
    const vat5 = docTotals([
      { kind: "GOODS", qty: "1", unitPrice: "10000", supplierUnitCost: "0", withholdingRate: "0.0500", withholdingAtc: "WV010/WV020" },
    ]);
    expect(vat5.withholding[0]).toMatchObject({
      code: "GOV_VAT_5",
      label: "VAT withheld 5% (WV010/WV020)",
    });

    // WG010 = legacy read-only alias → WB080 / GOV_PT_3. Must never return to Settings.
    const wg010 = docTotals([
      { kind: "GOODS", qty: "1", unitPrice: "10000", supplierUnitCost: "0", withholdingRate: "0.0300", withholdingAtc: "WG010" },
    ]);
    expect(wg010.withholding[0]).toMatchObject({
      code: "GOV_PT_3",
      label: "Government percentage tax 3% (WB080)",
      atcCode: "WG010",
    });
  });

  it("with no withholding rates, net received = contract price", () => {
    const t = docTotals([
      { kind: "GOODS", qty: "10", unitPrice: "52000", supplierUnitCost: "45000" },
      { kind: "SERVICES", qty: "1", unitPrice: "20000", supplierUnitCost: "5000" },
    ]);
    expect(t.netReceived).toBe(t.contractPrice);
    expect(t.netMargin).toBe("85000.00");
    expect(t.netMarginPct).toBe("15.74");
  });

  it("handles an empty quote and negative margins", () => {
    expect(docTotals([]).netMarginPct).toBe("0.00");
    expect(docTotals([]).supplierCostState).toBe("none");
    const t = docTotals([{ kind: "GOODS", qty: "1", unitPrice: "100", supplierUnitCost: "150" }]);
    expect(t.netMargin).toBe("-50.00");
    expect(t.netMarginPct).toBe("-50.00");
    expect(t.supplierCostState).toBe("full");
  });

  it("keeps netMarginPct at 100.00 when supplier cost is blank, and labels that state none", () => {
    const t = docTotals([{ kind: "GOODS", qty: "1", unitPrice: "500000", supplierUnitCost: "0" }]);
    expect(t.netMargin).toBe("500000.00");
    expect(t.netMarginPct).toBe("100.00");
    expect(t.supplierCostState).toBe("none");
    expect(COST_NOT_SET_LABEL).toBe("Cost not set");
    expect(linesMissingSupplierCost([{ supplierUnitCost: "" }, { supplierUnitCost: "0.00" }])).toBe(true);
    expect(linesMissingSupplierCost([{ supplierUnitCost: "0.01" }])).toBe(false);
    expect(supplierCostStateFromSupplierTotals(["0.00", "10.00"])).toBe("partial");
    const mixed = docTotals([
      { kind: "GOODS", qty: "1", unitPrice: "100", supplierUnitCost: "0" },
      { kind: "GOODS", qty: "1", unitPrice: "100", supplierUnitCost: "40" },
    ]);
    expect(mixed.supplierCostState).toBe("partial");
    expect(mixed.netMarginPct).toBe("80.00");
  });

  it("matches the design brief example (₱510,000 / ₱450,000 → 11.76%)", () => {
    const t = docTotals([{ kind: "GOODS", qty: "1", unitPrice: "510000", supplierUnitCost: "450000" }]);
    expect(t.netMargin).toBe("60000.00");
    expect(t.netMarginPct).toBe("11.76");
  });
});

describe("planItems re-apply respects overrides", () => {
  it("manual override survives re-apply; other lines refresh", () => {
    const existing = [
      {
        id: "a",
        kind: "GOODS" as const,
        supplierId: null,
        supplierUnitCost: "0",
        withholdingRate: "0.0150",
        withholdingAtc: "WI158",
        withholdingOverride: true,
      },
      {
        id: "b",
        kind: "SERVICES" as const,
        supplierId: null,
        supplierUnitCost: "0",
        withholdingRate: "0.0200",
        withholdingAtc: "WI160",
        withholdingOverride: false,
      },
    ];
    const { items } = planItems(
      existing,
      [
        {
          id: "a",
          description: "Laptop",
          kind: "GOODS",
          qty: "1",
          unit: "pc",
          supplierId: null,
          supplierUnitCost: "0",
          unitPrice: "1000",
          withholdingRate: "0.0150",
          withholdingAtc: "WI158",
          withholdingOverride: true,
        },
        {
          id: "b",
          description: "Install",
          kind: "SERVICES",
          qty: "1",
          unit: "lot",
          supplierId: null,
          supplierUnitCost: "0",
          unitPrice: "500",
          withholdingRate: "0.0200",
          withholdingAtc: "WI160",
          withholdingOverride: false,
        },
      ],
      false,
      {
        withholdingPicks: [
          {
            code: "GOV_PT_3",
            label: "Government percentage tax 3% (WB080)",
            lineKind: "GOV_PT",
            rate: "0.0300",
            atcCode: "WB080",
          },
        ],
        reapplyWithholding: true,
      },
    );
    expect(items[0]).toMatchObject({ withholdingRate: "0.0150", withholdingAtc: "WI158", withholdingOverride: true });
    expect(items[1]).toMatchObject({ withholdingRate: "0.0300", withholdingAtc: "WB080", withholdingOverride: false });
  });
});

describe("approval flag", () => {
  const approval = { marginBelowPct: 18, totalAbove: 500_000 };
  it("flags low margin and big totals", () => {
    expect(approvalReasons({ contractPrice: "540000.00", netMarginPct: "11.78", supplierCostState: "full" }, approval)).toHaveLength(2);
    expect(approvalReasons({ contractPrice: "100000.00", netMarginPct: "18.00", supplierCostState: "full" }, approval)).toEqual([]);
    expect(approvalReasons({ contractPrice: "500000.00", netMarginPct: "17.99", supplierCostState: "full" }, approval)).toEqual(["Margin is below 18%"]);
  });
  it("a blank or ₱0.00 supplier cost needs approval; an entered cost uses the margin rule", () => {
    const blank = docTotals([{ kind: "GOODS", qty: "1", unitPrice: "1000", supplierUnitCost: "" }]);
    expect(blank.netMarginPct).toBe("100.00");
    expect(approvalReasons(blank, approval)).toEqual(["Cost not set"]);

    const zero = docTotals([{ kind: "GOODS", qty: "1", unitPrice: "1000", supplierUnitCost: "0.00" }]);
    expect(zero.supplierCostState).toBe("none");
    expect(approvalReasons(zero, approval)).toEqual(["Cost not set"]);

    const entered = docTotals([{ kind: "GOODS", qty: "1", unitPrice: "1000", supplierUnitCost: "800" }]);
    expect(entered.supplierCostState).toBe("full");
    expect(entered.netMarginPct).toBe("20.00");
    expect(approvalReasons(entered, approval)).toEqual([]);

    const low = docTotals([{ kind: "GOODS", qty: "1", unitPrice: "1000", supplierUnitCost: "900" }]);
    expect(approvalReasons(low, approval)).toEqual(["Margin is below 18%"]);
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
