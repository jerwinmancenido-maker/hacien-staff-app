// Cost & margin tab: basis choice, margin math, voids stay out of inputs, warnings.

import { describe, expect, it } from "vitest";
import {
  actualMargin,
  billExceedsPo,
  buildCostMarginSummary,
  chooseCostBasis,
  lineNeedsMorePo,
  sumMoney,
  valueReceived,
  type CostMarginPoInput,
} from "@/lib/purchasing/cost-margin";

const po = (extra: Partial<CostMarginPoInput> = {}): CostMarginPoInput => ({
  id: "po1",
  number: "PO-2026-0001",
  status: "SENT",
  supplierName: "Acme",
  poTotal: "100000.00",
  receivedValue: "0.00",
  billedAmount: "0.00",
  hasBills: false,
  hasReceipts: false,
  ...extra,
});

describe("chooseCostBasis", () => {
  it("uses billed when any non-void bill exists (even if amount is 0)", () => {
    expect(chooseCostBasis({ ...po({ billedAmount: "0.00", hasBills: true, hasReceipts: true, receivedValue: "50.00" }) })).toEqual({
      basis: "BILLED",
      cost: "0.00",
      basisLabel: "Billed",
    });
    expect(chooseCostBasis(po({ billedAmount: "88000.00", hasBills: true, receivedValue: "50000.00", hasReceipts: true }))).toMatchObject({
      basis: "BILLED",
      cost: "88000.00",
    });
  });

  it("falls back to received, then PO total", () => {
    expect(chooseCostBasis(po({ receivedValue: "45000.00", hasReceipts: true }))).toEqual({
      basis: "RECEIVED",
      cost: "45000.00",
      basisLabel: "Received",
    });
    expect(chooseCostBasis(po())).toEqual({ basis: "PO_TOTAL", cost: "100000.00", basisLabel: "PO total" });
  });
});

describe("actualMargin", () => {
  it("uses scaled decimals only (contract − cost, % of contract)", () => {
    expect(actualMargin("540000.00", "470000.00")).toEqual({ margin: "70000.00", marginPct: "12.96" });
    expect(actualMargin("3.00", "1.00")).toEqual({ margin: "2.00", marginPct: "66.67" });
    expect(actualMargin("0.00", "10.00")).toEqual({ margin: "-10.00", marginPct: "0.00" });
    expect(actualMargin("100.00", "100.00")).toEqual({ margin: "0.00", marginPct: "0.00" });
  });
});

describe("valueReceived and sumMoney", () => {
  it("multiplies qty × unit cost with half-away rounding, no float drift", () => {
    expect(valueReceived([{ qtyReceived: "2.00", unitCost: "45000.00" }])).toBe("90000.00");
    expect(valueReceived([{ qtyReceived: "0.10", unitCost: "0.10" }, { qtyReceived: "1.00", unitCost: "0.01" }])).toBe("0.02");
    expect(sumMoney(["0.10", "0.20", "0.01"])).toBe("0.31");
  });
});

describe("warnings helpers", () => {
  it("flags SO lines still short of PO qty", () => {
    expect(lineNeedsMorePo("10.00", "0.00")).toBe(true);
    expect(lineNeedsMorePo("10.00", "9.99")).toBe(true);
    expect(lineNeedsMorePo("10.00", "10.00")).toBe(false);
    expect(lineNeedsMorePo("10.00", "12.00")).toBe(false);
  });

  it("flags when billed amount exceeds the PO total", () => {
    expect(billExceedsPo("100000.00", "100000.01")).toBe(true);
    expect(billExceedsPo("100000.00", "100000.00")).toBe(false);
    expect(billExceedsPo("100000.00", "0.00")).toBe(false);
  });
});

describe("buildCostMarginSummary", () => {
  it("sums row costs by basis and compares actual vs planned margin", () => {
    const summary = buildCostMarginSummary({
      contractPrice: "540000.00",
      plannedMargin: "70000.00",
      plannedMarginPct: "12.96",
      uncoveredLineCount: 0,
      pos: [
        po({ id: "a", poTotal: "200000.00", hasBills: true, billedAmount: "190000.00" }),
        po({ id: "b", number: "PO-2", poTotal: "300000.00", hasReceipts: true, receivedValue: "280000.00" }),
      ],
    });
    expect(summary.rows.map((r) => r.basis)).toEqual(["BILLED", "RECEIVED"]);
    expect(summary.totalCost).toBe("470000.00");
    expect(summary.actual).toEqual({ margin: "70000.00", marginPct: "12.96" });
    expect(summary.planned).toEqual({ margin: "70000.00", marginPct: "12.96" });
    expect(summary.warnings).toEqual([]);
  });

  it("emits both warnings with hints; void docs are simply never passed in", () => {
    const summary = buildCostMarginSummary({
      contractPrice: "100000.00",
      plannedMargin: "20000.00",
      plannedMarginPct: "20.00",
      uncoveredLineCount: 2,
      pos: [po({ billedAmount: "150000.00", hasBills: true })],
    });
    expect(summary.warnings.map((w) => w.code)).toEqual(["LINES_WITHOUT_PO", "BILLED_OVER_PO"]);
    expect(summary.warnings[0]!.title).toBe("Some lines have no supplier PO yet");
    expect(summary.warnings[0]!.hint).toMatch(/Create POs/i);
    expect(summary.warnings[1]!.title).toBe("Supplier billed more than the PO");
    expect(summary.warnings[1]!.hint).toMatch(/Match tab/i);
    expect(summary.rows[0]!.billedOverPo).toBe(true);
    // A void PO would not appear in `pos` (caller filters status ≠ VOID).
    expect(summary.rows.every((r) => r.status !== "VOID")).toBe(true);
  });
});
