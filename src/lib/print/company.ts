// Letterhead helpers: map Settings → print company block; warn when TIN/address missing.

import type { Settings } from "@/lib/settings/schema";
import { accountNumberForPrint } from "./account-number";
import type { PaperSize, PrintCompanyBlock, PrintPaymentInstruction } from "./types";

export type CompanySettings = Settings["company"];
export type PrintSettings = Settings["print"];

export function missingCompanyPrintFields(company: CompanySettings): string[] {
  const missing: string[] = [];
  if (!company.tin?.trim()) missing.push("TIN");
  if (!company.address?.trim()) missing.push("address");
  return missing;
}

/** Human warning for the Settings page and print toolbar. */
export function missingCompanyWarning(company: CompanySettings): string | null {
  const missing = missingCompanyPrintFields(company);
  if (missing.length === 0) return null;
  if (missing.includes("TIN") && missing.length === 1) return "Add your TIN so it prints on documents.";
  if (missing.includes("address") && missing.length === 1) return "Add your address so it prints on documents.";
  return `Add your ${missing.join(" and ")} so they print on documents.`;
}

/** Default letterhead mark from the HACIEN brand kit. Settings upload overrides. */
export const BRAND_LETTERHEAD_LOGO = "/brand/logo-full.svg";

export function printCompanyBlock(company: CompanySettings): PrintCompanyBlock {
  return {
    registeredName: company.name,
    tradeName: company.tradeName?.trim() || "",
    tin: company.tin?.trim() || "",
    address: company.address?.trim() || "",
    phone: company.phone?.trim() || "",
    email: company.email?.trim() || "",
    website: company.website?.trim() || "",
    // Settings logo wins; otherwise the brand kit full logo.
    logoUrl: company.logoStorageKey?.trim() ? "/files/company-logo" : BRAND_LETTERHEAD_LOGO,
  };
}

export function paymentInstructionsFromSettings(print: PrintSettings): PrintPaymentInstruction[] {
  const banks = (print.banks ?? []).map((b) => ({
    kind: "bank" as const,
    label: b.bankName,
    accountName: b.accountName,
    accountLast4: b.accountLast4,
    accountPrinted: accountNumberForPrint(b),
  }));
  const wallets = (print.eWallets ?? []).map((w) => ({
    kind: "ewallet" as const,
    label: w.provider,
    accountName: w.accountName,
    accountLast4: w.accountLast4,
    accountPrinted: accountNumberForPrint(w),
  }));
  return [...banks, ...wallets];
}

export function paperSizeFromSettings(print: PrintSettings): PaperSize {
  return print.paperSize === "Letter" ? "Letter" : "A4";
}

/** Short contact line under the thank-you footer. */
export function companyContactLine(company: CompanySettings): string {
  const bits = [company.phone?.trim(), company.email?.trim(), company.website?.trim()].filter(Boolean);
  return bits.length ? bits.join(" · ") : company.name;
}

export function watermarkForStatus(status: string): "DRAFT" | "VOID" | null {
  const s = status.toUpperCase();
  if (s === "VOID") return "VOID";
  if (s === "DRAFT") return "DRAFT";
  return null;
}
