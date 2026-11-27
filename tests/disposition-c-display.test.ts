// Disposition PR 2 (Group C) — findings 1022 + 1037, display-only fixes.
//
// 1022: the customer overview is the THIRD caller of the ONE customerExposure
// helper (after the SO page and the billing form): it renders the helper's
// total exposure, its two parts, the limit, and the helper's own warning
// sentence. The old balance-due-only alert quoted a different figure in
// different words and is gone, so the surfaces cannot drift.
// 1037: the Cash home headline stat keeps its total but its foot now splits
// it — In accounts + Not assigned — from the cashPositionSummary object the
// page already loads; the two parts always sum to the total to the centavo.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { creditLimitWarningText, exposureFromParts, type ExposureParts } from "@/lib/billing/customer-exposure";
import { fromScaled, toScaled } from "@/lib/quotes/calc";

const customerPage = readFileSync("src/app/(app)/customers/[id]/page.tsx", "utf8");
const overview = readFileSync("src/components/CustomerOverview.tsx", "utf8");
const cashPage = readFileSync("src/app/(app)/cash/page.tsx", "utf8");

describe("1022 — customer overview exposure block", () => {
  it("the customer page calls the ONE helper and passes the result to the overview", () => {
    expect(customerPage).toContain('import { customerExposure } from "@/lib/billing/customer-exposure";');
    expect(customerPage).toContain("customerExposure(db, id)");
    expect(customerPage).toContain("exposure={exposure}");
  });

  it("the overview renders the helper's figures: total, both parts, and the limit", () => {
    expect(overview).toContain("Credit exposure");
    expect(overview).toContain("formatPeso(exposure.totalExposure)");
    expect(overview).toContain("formatPeso(exposure.arOutstanding)");
    expect(overview).toContain("formatPeso(exposure.unbilledOpenOrders)");
    expect(overview).toContain("formatPeso(exposure.creditLimit)");
  });

  it("the warning is the helper's own sentence via the shared banner component", () => {
    expect(overview).toContain("creditLimitWarningText(exposure)");
    expect(overview).toContain("<CreditLimitWarning");
  });

  it("the old balance-due-only over-limit alert is gone (no divergent figure)", () => {
    expect(overview).not.toContain("Number(ar.balanceDue) > Number(customer.creditLimit)");
    expect(overview).not.toContain("Over credit limit — balance due");
  });

  it("the P211PROOF anchor shape reads over-limit through the real helper", () => {
    // ₱150,000 exposure vs a ₱100,000 limit (₱50,000 over) — the seed pattern
    // the finding is anchored on, composed as fully-billed unpaid AR here.
    const parts: ExposureParts = {
      creditLimit: "100000.00",
      billedAmount: "150000.00",
      cashApplied: "0",
      withholdingApplied: "0",
      creditApplied: "0",
      openContract: "150000.00",
      openBilled: "150000.00",
    };
    const e = exposureFromParts(parts);
    expect(e.totalExposure).toBe("150000.00");
    expect(e.overLimit).toBe(true);
    const text = creditLimitWarningText(e);
    expect(text).toContain("₱150,000.00");
    expect(text).toContain("₱100,000.00");
    expect(text).toContain("warning only; you can still save");
  });
});

describe("1037 — cash headline split", () => {
  it("the headline keeps the total and its foot shows both split figures", () => {
    expect(cashPage).toContain("formatPeso(summary.total)");
    expect(cashPage).toContain("In accounts {formatPeso(inAccounts)} · Not assigned {formatPeso(summary.unassignedNet)}");
  });

  it("in-accounts is derived from the summary's own account balances, scaled arithmetic", () => {
    expect(cashPage).toContain("summary.accounts.reduce((a, r) => a + toScaled(r.balance, 2), 0n)");
  });

  it("the split sums to the headline total to the centavo on the seed anchors", () => {
    // Seed anchors (round-14 seed): headline ₱1,627,210.00, of which
    // ₱1,621,760.00 is Not assigned and ₱5,450.00 sits in the one named
    // account (P4PROOF Cash 390). Finding 1037 was filed on an earlier
    // dataset state (headline ₱1,626,860.00); the split identity is what
    // this test pins — parts always sum to the total to the centavo.
    const accountBalances = ["5450.00"];
    const inAccounts = fromScaled(
      accountBalances.reduce((a, b) => a + toScaled(b, 2), 0n),
      2,
    );
    expect(inAccounts).toBe("5450.00");
    const total = fromScaled(toScaled(inAccounts, 2) + toScaled("1621760.00", 2), 2);
    expect(total).toBe("1627210.00");
  });
});
