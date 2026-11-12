import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isKnownBank, resolveSupplierBank } from "@/lib/banks";

describe("resolveSupplierBank", () => {
  it("prefers an explicit bankName and keeps the stored branch", () => {
    expect(resolveSupplierBank({ bankName: "BPI", bankBranch: "Makati" })).toEqual({
      bankName: "BPI",
      branch: "Makati",
    });
    expect(resolveSupplierBank({ bankName: "Wise", bankBranch: null })).toEqual({
      bankName: "Wise",
      branch: null,
    });
  });

  it("splits a legacy 'Bank – Branch' bankBranch (en dash or hyphen)", () => {
    expect(resolveSupplierBank({ bankName: null, bankBranch: "UnionBank – Ortigas" })).toEqual({
      bankName: "UnionBank",
      branch: "Ortigas",
    });
    expect(resolveSupplierBank({ bankName: null, bankBranch: "BDO - Quezon City" })).toEqual({
      bankName: "BDO",
      branch: "Quezon City",
    });
  });

  it("treats a bankBranch that is only a bank name as the bank", () => {
    expect(resolveSupplierBank({ bankName: null, bankBranch: "Metrobank" })).toEqual({
      bankName: "Metrobank",
      branch: null,
    });
  });

  it("matches known banks case-insensitively and returns the canonical name", () => {
    expect(resolveSupplierBank({ bankName: null, bankBranch: "unionbank – ortigas" })).toEqual({
      bankName: "UnionBank",
      branch: "ortigas",
    });
    expect(isKnownBank("bpi")).toBe(true);
    expect(isKnownBank("Wise")).toBe(false);
  });

  it("never guesses: ambiguous branch text stays branch-only", () => {
    expect(resolveSupplierBank({ bankName: null, bankBranch: "Makati Main Office" })).toEqual({
      bankName: null,
      branch: "Makati Main Office",
    });
    expect(resolveSupplierBank({ bankName: null, bankBranch: "Some Bank – Ortigas" })).toEqual({
      bankName: null,
      branch: "Some Bank – Ortigas",
    });
  });

  it("handles blanks", () => {
    expect(resolveSupplierBank({ bankName: null, bankBranch: null })).toEqual({ bankName: null, branch: null });
    expect(resolveSupplierBank({ bankName: "  ", bankBranch: "" })).toEqual({ bankName: null, branch: null });
  });
});

describe("supplier bank surfaces no longer assume UnionBank", () => {
  const form = readFileSync("src/app/(app)/suppliers/SupplierForm.tsx", "utf8");
  const overview = readFileSync("src/components/SupplierOverview.tsx", "utf8");
  const list = readFileSync("src/app/(app)/suppliers/page.tsx", "utf8");
  const paymentForm = readFileSync("src/components/payables/PaymentForm.tsx", "utf8");
  const paymentValidation = readFileSync("src/lib/validation/payables.ts", "utf8");

  it("the supplier form offers a bank picker and stores bankName", () => {
    expect(form).toContain("Bank details");
    expect(form).not.toContain("UnionBank details");
    expect(form).toContain("PH_BANKS");
    expect(form).toContain('name="bankName"');
    expect(form).toContain("OTHER_BANK");
  });

  it("list and overview resolve the supplier's own bank", () => {
    expect(list).toContain("resolveSupplierBank");
    expect(list).not.toContain("UnionBank ·");
    expect(overview).toContain("resolveSupplierBank");
    expect(overview).not.toContain(">UnionBank<");
  });

  it("the payment form and validation use the supplier's bank + generic reference wording", () => {
    expect(paymentForm).toContain("supplierBankName");
    expect(paymentForm).not.toContain("Paying to UnionBank");
    expect(paymentForm).toContain("Bank transfer reference");
    expect(paymentValidation).toContain("Add the bank transfer reference");
    expect(paymentValidation).not.toContain("UnionBank reference");
  });
});
