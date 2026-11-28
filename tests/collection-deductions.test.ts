// Collection deductions (ERP payment-entry model, 2026-11-28): pure
// helpers — normalisation (incl. the PR #354 legacy fee fold-in), the
// bounds, the expense-notes fingerprints, and the settlement proof.
import { describe, expect, it } from "vitest";
import {
  deductionExpenseNotes,
  deductionRowsTotal,
  deductionsError,
  feeRowsTotal,
  normaliseDeductions,
  settlementProof,
} from "@/lib/billing/deductions";

describe("normaliseDeductions", () => {
  it("folds the legacy feeAmount in as one FEE row", () => {
    expect(normaliseDeductions({ feeAmount: "25.00" })).toEqual([
      { kind: "FEE", label: null, amount: "25.00", cashAffecting: true },
    ]);
  });

  it("treats a zero or absent feeAmount as no fee (pre-fee behaviour)", () => {
    expect(normaliseDeductions({ feeAmount: "0.00" })).toEqual([]);
    expect(normaliseDeductions({})).toEqual([]);
  });

  it("trims OTHER labels, drops labels on FEE rows, forces FEE cash-affecting", () => {
    const rows = normaliseDeductions({
      deductions: [
        { kind: "FEE", label: "ignored", amount: "10", cashAffecting: false },
        { kind: "OTHER", label: "  Bank charge  ", amount: "5.5" },
        { kind: "OTHER", label: "Short payment", amount: "7", cashAffecting: false },
      ],
    });
    expect(rows).toEqual([
      { kind: "FEE", label: null, amount: "10.00", cashAffecting: true },
      { kind: "OTHER", label: "Bank charge", amount: "5.50", cashAffecting: true },
      { kind: "OTHER", label: "Short payment", amount: "7.00", cashAffecting: false },
    ]);
  });

  it("totals: rows total counts FEE + OTHER; fee total counts FEE only", () => {
    const rows = normaliseDeductions({
      feeAmount: "10.00",
      deductions: [{ kind: "OTHER", label: "x", amount: "2.50" }],
    });
    expect(deductionRowsTotal(rows)).toBe("12.50");
    expect(feeRowsTotal(rows)).toBe("10.00");
  });
});

describe("deductionsError", () => {
  const ok = { amountReceived: "1000.00", applied: "1000.00", withholding: "0.00" };

  it("accepts rows within every bound", () => {
    const rows = normaliseDeductions({
      deductions: [
        { kind: "FEE", amount: "25.00" },
        { kind: "OTHER", label: "Charge", amount: "10.00", cashAffecting: false },
      ],
    });
    expect(deductionsError(rows, { ...ok, withholding: "60.00" })).toBeNull();
  });

  it("refuses a zero or negative row", () => {
    const rows = normaliseDeductions({ deductions: [{ kind: "FEE", amount: "0.00" }] });
    // normalise keeps posted rows; a 0 row is an error, not a no-op.
    expect(deductionsError(rows, ok)).toMatch(/above ₱0.00/);
  });

  it("refuses an OTHER row with no label", () => {
    const rows = normaliseDeductions({ deductions: [{ kind: "OTHER", amount: "10.00" }] });
    expect(deductionsError(rows, ok)).toMatch(/label/);
  });

  it("keeps the PR #354 message for a lone fee above the amount received", () => {
    const rows = normaliseDeductions({ feeAmount: "300.01" });
    expect(
      deductionsError(rows, { amountReceived: "300.00", applied: "300.00", withholding: "0.00" }),
    ).toBe("Collection fee can't be more than the amount received (₱300.00). Lower the fee.");
  });

  it("refuses rows totalling above the amount received", () => {
    const rows = normaliseDeductions({
      deductions: [
        { kind: "FEE", amount: "200.00" },
        { kind: "OTHER", label: "Charge", amount: "150.00" },
      ],
    });
    expect(
      deductionsError(rows, { amountReceived: "300.00", applied: "300.00", withholding: "0.00" }),
    ).toMatch(/Deductions can't be more than the amount received/);
  });

  it("refuses when withholding + rows exceed the amount applied (cash would go negative)", () => {
    const rows = normaliseDeductions({ deductions: [{ kind: "FEE", amount: "50.00" }] });
    expect(
      deductionsError(rows, { amountReceived: "1000.00", applied: "940.00", withholding: "900.00" }),
    ).toMatch(/can't be more than the amount applied/);
  });

  it("skips the applied bound when nothing is applied (deposit / credit)", () => {
    const rows = normaliseDeductions({ deductions: [{ kind: "FEE", amount: "50.00" }] });
    expect(
      deductionsError(rows, { amountReceived: "1000.00", applied: "0.00", withholding: "0.00" }),
    ).toBeNull();
  });
});

describe("deductionExpenseNotes", () => {
  it("FEE keeps the PR #354 fingerprint verbatim", () => {
    expect(deductionExpenseNotes({ kind: "FEE", label: null }, "CR-2026-0001", ["BL-2026-0001"])).toBe(
      "Collection fee withheld from collection - collection CR-2026-0001, billing BL-2026-0001.",
    );
    expect(deductionExpenseNotes({ kind: "FEE", label: null }, "CR-2026-0001", [])).toBe(
      "Collection fee withheld from collection - collection CR-2026-0001.",
    );
  });

  it("OTHER carries its label in the fingerprint", () => {
    expect(
      deductionExpenseNotes({ kind: "OTHER", label: "Withholding shortfall" }, "CR-2026-0002", [
        "BL-2026-0002",
        "BL-2026-0003",
      ]),
    ).toBe(
      "Collection deduction (Withholding shortfall) withheld from collection - collection CR-2026-0002, billing BL-2026-0002, BL-2026-0003.",
    );
  });
});

describe("settlementProof", () => {
  it("fee case: applied 10,000 = cash 9,900 + deductions 100", () => {
    const rows = normaliseDeductions({ deductions: [{ kind: "FEE", amount: "100.00" }] });
    expect(
      settlementProof({ cashApplied: "10000.00", withholdingApplied: "0.00", rows }),
    ).toEqual({ applied: "10000.00", cash: "9900.00", deductions: "100.00", withholding: "0.00" });
  });

  it("government case: applied 100,000 = cash 94,000 + withholding 6,000", () => {
    expect(
      settlementProof({ cashApplied: "94000.00", withholdingApplied: "6000.00", rows: [] }),
    ).toEqual({ applied: "100000.00", cash: "94000.00", deductions: "6000.00", withholding: "6000.00" });
  });

  it("mixed case: withholding + fee + settlement-only other all count as deductions", () => {
    const rows = normaliseDeductions({
      deductions: [
        { kind: "FEE", amount: "100.00" },
        { kind: "OTHER", label: "Short payment", amount: "500.00", cashAffecting: false },
      ],
    });
    expect(
      settlementProof({ cashApplied: "9400.00", withholdingApplied: "600.00", rows }),
    ).toEqual({ applied: "10000.00", cash: "8800.00", deductions: "1200.00", withholding: "600.00" });
  });
});
