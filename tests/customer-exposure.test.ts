// Phase 2 #6 — customerExposure pure combination logic (scenarios C1–C5
// at the arithmetic level; the DB-level suite is
// tests/db/customer-exposure.db.test.ts). Imports the REAL helper module.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { creditLimitWarningText, exposureFromParts, type ExposureParts } from "@/lib/billing/customer-exposure";

const parts = (over: Partial<ExposureParts> = {}): ExposureParts => ({
  creditLimit: "100000.00",
  billedAmount: "0",
  cashApplied: "0",
  withholdingApplied: "0",
  creditApplied: "0",
  openContract: "0",
  openBilled: "0",
  ...over,
});

describe("customerExposure — exposureFromParts", () => {
  it("C1: AR ₱30k + unbilled open SO ₱80k = ₱110k exposure, over a ₱100k limit", () => {
    // Bill ₱110k total across two SOs: SO-A fully billed ₱30k (unpaid),
    // SO-B contract ₱80k with nothing billed yet.
    const e = exposureFromParts(parts({ billedAmount: "30000.00", openContract: "110000.00", openBilled: "30000.00" }));
    expect(e.arOutstanding).toBe("30000.00");
    expect(e.unbilledOpenOrders).toBe("80000.00");
    expect(e.totalExposure).toBe("110000.00");
    expect(e.overLimit).toBe(true);
    const text = creditLimitWarningText(e);
    expect(text).toContain("₱110,000.00");
    expect(text).toContain("₱100,000.00");
    expect(text).toContain("warning only");
  });

  it("C2: everything collected and billed → ₱0 exposure, no warning", () => {
    const e = exposureFromParts(
      parts({ billedAmount: "50000.00", cashApplied: "49500.00", withholdingApplied: "500.00", openContract: "50000.00", openBilled: "50000.00" }),
    );
    expect(e.totalExposure).toBe("0.00");
    expect(e.overLimit).toBe(false);
    expect(creditLimitWarningText(e)).toBeNull();
  });

  it("C3: no limit set (null) or ₱0 limit → never warns, however large the exposure", () => {
    const big = { billedAmount: "900000.00", openContract: "900000.00", openBilled: "0" };
    expect(exposureFromParts(parts({ ...big, creditLimit: null })).overLimit).toBe(false);
    expect(exposureFromParts(parts({ ...big, creditLimit: "0.00" })).overLimit).toBe(false);
    expect(creditLimitWarningText(exposureFromParts(parts({ ...big, creditLimit: null })))).toBeNull();
  });

  it("exposure exactly at the limit does not warn (warning starts past it)", () => {
    const e = exposureFromParts(parts({ billedAmount: "100000.00", openContract: "100000.00", openBilled: "100000.00" }));
    expect(e.totalExposure).toBe("100000.00");
    expect(e.overLimit).toBe(false);
  });

  it("return-credit applications reduce AR like cash does", () => {
    const e = exposureFromParts(parts({ billedAmount: "40000.00", creditApplied: "15000.00", openContract: "40000.00", openBilled: "40000.00" }));
    expect(e.arOutstanding).toBe("25000.00");
  });

  it("over-applied or over-billed rows floor at ₱0, never negative exposure", () => {
    const e = exposureFromParts(parts({ billedAmount: "100.00", cashApplied: "150.00", openContract: "100.00", openBilled: "250.00" }));
    expect(e.arOutstanding).toBe("0.00");
    expect(e.unbilledOpenOrders).toBe("0.00");
    expect(e.totalExposure).toBe("0.00");
  });
});

describe("customerExposure — wiring (one helper, both surfaces)", () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("the SO page and the new-billing page both use customerExposure + the shared warning text", () => {
    const soPage = src("src/app/(app)/sales-orders/[id]/page.tsx");
    expect(soPage).toContain("customerExposure(db, so.customer.id)");
    expect(soPage).toContain("creditLimitWarningText(exposure)");
    const billingPage = src("src/app/(app)/billing/billings/new/page.tsx");
    expect(billingPage).toContain("customerExposure(db, so.customer.id)");
    expect(billingPage).toContain("creditWarning={creditLimitWarningText(exposure)}");
  });

  it("the helper never throws or blocks: no DocRuleError / ForbiddenError in the module", () => {
    const helper = src("src/lib/billing/customer-exposure.ts");
    expect(helper).not.toContain("DocRuleError");
    expect(helper).not.toContain("throw");
  });
});
