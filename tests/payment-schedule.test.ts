// ERP adoption item 14 — the billing statement's printed payment schedule.
//
// buildPaymentSchedule keys on resolvePaymentTerm's structured kind (the
// same classification that drives the terms block's Point 2 and the
// printed Remarks row), so the schedule can only appear for COD, 50/50
// and Net 30 terms — the three kinds the item-10 presets name — and the
// rows always sum exactly to the billing's gross Total.

import { describe, expect, it } from "vitest";
import { formatDate } from "@/lib/format";
import { fromScaled, toScaled } from "@/lib/quotes/calc";
import { buildPaymentSchedule } from "@/lib/print/payment-schedule";

const COD = "COD";
const FIFTY_FIFTY = "50% down, 50% on delivery"; // the item-10 "50/50" preset text
const NET30 = "Net 30 (approved accounts only)"; // the item-10 "Net 30" preset text
const UPFRONT = "100% upfront (software and special orders)"; // the "100% upfront" preset text

describe("buildPaymentSchedule — schedulable kinds", () => {
  it("COD: one row, the full Total, due on delivery", () => {
    expect(buildPaymentSchedule({ paymentTerms: COD, total: "5450.00", invoiceDateYmd: "2026-11-20" })).toEqual([
      { label: "100% — Cash on Delivery", due: "On delivery", amount: "5450.00" },
    ]);
  });

  it("COD matches case-insensitively, like resolvePaymentTerm", () => {
    expect(buildPaymentSchedule({ paymentTerms: "cod", total: "10.00", invoiceDateYmd: "2026-11-20" })).toHaveLength(1);
  });

  it("50/50: two rows, order confirmation then delivery, even split", () => {
    expect(buildPaymentSchedule({ paymentTerms: FIFTY_FIFTY, total: "10000.00", invoiceDateYmd: "2026-11-12" })).toEqual([
      { label: "50% — down payment", due: "On order confirmation", amount: "5000.00" },
      { label: "50% — balance", due: "On delivery", amount: "5000.00" },
    ]);
  });

  it("50/50 with an odd centavo: the last row carries the remainder, sum stays exact", () => {
    const rows = buildPaymentSchedule({ paymentTerms: FIFTY_FIFTY, total: "100.01", invoiceDateYmd: "2026-11-12" })!;
    expect(rows.map((r) => r.amount)).toEqual(["50.01", "50.00"]);
    const sum = rows.reduce((a, r) => a + toScaled(r.amount, 2), 0n);
    expect(fromScaled(sum, 2)).toBe("100.01");
  });

  it("50/50 on a single centavo: 0.01 + 0.00, sum stays exact", () => {
    const rows = buildPaymentSchedule({ paymentTerms: FIFTY_FIFTY, total: "0.01", invoiceDateYmd: "2026-11-12" })!;
    expect(rows.map((r) => r.amount)).toEqual(["0.01", "0.00"]);
  });

  it("50/50 rows sum exactly to the Total across many totals", () => {
    for (const total of ["0.00", "0.03", "99.99", "123456.78", "750000.00", "1000000.01"]) {
      const rows = buildPaymentSchedule({ paymentTerms: FIFTY_FIFTY, total, invoiceDateYmd: "2026-11-12" })!;
      const sum = rows.reduce((a, r) => a + toScaled(r.amount, 2), 0n);
      expect(fromScaled(sum, 2)).toBe(total);
    }
  });

  it("Net 30: one row, the full Total, due date = invoice date + 30 days", () => {
    const rows = buildPaymentSchedule({ paymentTerms: NET30, total: "750000.00", invoiceDateYmd: "2026-11-09" })!;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe("750000.00");
    expect(rows[0]!.due).toBe(formatDate(new Date("2026-12-09T00:00:00.000Z")));
  });

  it("Net 30 also resolves from the bare list string", () => {
    expect(buildPaymentSchedule({ paymentTerms: "Net 30", total: "10.00", invoiceDateYmd: "2026-01-31" })).toEqual([
      { label: "100%", due: formatDate(new Date("2026-03-02T00:00:00.000Z")), amount: "10.00" },
    ]);
  });

  it("Net 30 without an invoice date prints no table (nothing truthful to derive)", () => {
    expect(buildPaymentSchedule({ paymentTerms: NET30, total: "10.00", invoiceDateYmd: null })).toBeNull();
  });
});

describe("buildPaymentSchedule — every other terms value prints no table", () => {
  it("100% upfront (the fourth preset) has no schedule", () => {
    expect(buildPaymentSchedule({ paymentTerms: UPFRONT, total: "10.00", invoiceDateYmd: "2026-11-20" })).toBeNull();
  });

  it("custom terms text has no schedule", () => {
    expect(buildPaymentSchedule({ paymentTerms: "Pay in 7 days, please", total: "10.00", invoiceDateYmd: "2026-11-20" })).toBeNull();
  });

  it("no terms recorded has no schedule", () => {
    for (const paymentTerms of [null, undefined, "", "   "]) {
      expect(buildPaymentSchedule({ paymentTerms, total: "10.00", invoiceDateYmd: "2026-11-20" })).toBeNull();
    }
  });
});
