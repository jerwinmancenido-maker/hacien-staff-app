import { z } from "zod";
import { normalizeTin, TIN_FORMAT_MESSAGE } from "./tin";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .transform((v) => (v ? v : null));

const tinField = z
  .string()
  .transform((v, ctx) => {
    const tin = normalizeTin(v);
    if (tin === "invalid") {
      ctx.addIssue({ code: "custom", message: TIN_FORMAT_MESSAGE });
      return z.NEVER;
    }
    return tin;
  });

export const WITHHOLDING_TYPES = ["GOVERNMENT", "TOP_WITHHOLDING_AGENT", "NONE"] as const;
export type WithholdingTypeValue = (typeof WITHHOLDING_TYPES)[number];
export const WITHHOLDING_LABELS: Record<WithholdingTypeValue, string> = {
  GOVERNMENT: "Government",
  TOP_WITHHOLDING_AGENT: "Top Withholding Agent",
  NONE: "No withholding",
};

export const SUPPLIER_TAX_TYPES = ["VAT", "NON_VAT", "NO_RECEIPT"] as const;
export type SupplierTaxTypeValue = (typeof SUPPLIER_TAX_TYPES)[number];
export const TAX_TYPE_LABELS: Record<SupplierTaxTypeValue, string> = {
  VAT: "VAT",
  NON_VAT: "Non-VAT",
  NO_RECEIPT: "Usually no receipt",
};

/** Default terms must be one of the options in Settings → Lists (or empty). */
function termsField(allowedTerms: readonly string[]) {
  return z
    .string()
    .trim()
    .refine((v) => !v || allowedTerms.includes(v), "Pick terms from the list.")
    .transform((v) => (v ? v : null));
}

/**
 * `allowedWithholdingCodes`: rate codes from Settings → Withholding the customer
 * may default to (omit to skip the check, e.g. in tests).
 */
export function customerSchema(allowedTerms: readonly string[], allowedWithholdingCodes?: readonly string[]) {
  return z.object({
    name: z.string().trim().min(1, "Name is required.").max(191),
    tin: tinField,
    withholdingType: z.enum(WITHHOLDING_TYPES, { error: "Pick a withholding type." }),
    // Default withholding rates copied onto new quotes (may be empty).
    defaultWithholding: z
      .array(z.string().trim().min(1).max(32))
      .max(20)
      .default([])
      .refine((codes) => !allowedWithholdingCodes || codes.every((c) => allowedWithholdingCodes.includes(c)), "Pick rates from the list.")
      .transform((codes) => [...new Set(codes)]),
    defaultTerms: termsField(allowedTerms),
    notes: optionalText(5000),
  });
}
export type CustomerInput = z.infer<ReturnType<typeof customerSchema>>;

export function supplierSchema(allowedTerms: readonly string[]) {
  return z.object({
    name: z.string().trim().min(1, "Name is required.").max(191),
    tin: tinField,
    taxType: z.enum(SUPPLIER_TAX_TYPES, { error: "Pick a tax type." }),
    defaultTerms: termsField(allowedTerms),
    bankAccountName: optionalText(191),
    bankAccountNumber: optionalText(64),
    bankBranch: optionalText(191),
    bankNotes: optionalText(2000),
    notes: optionalText(5000),
  });
}
export type SupplierInput = z.infer<ReturnType<typeof supplierSchema>>;

/** Warning (not a block) shown on suppliers without bank details. */
export function missingBankDetails(s: {
  bankAccountName: string | null;
  bankAccountNumber: string | null;
}): boolean {
  return !s.bankAccountName?.trim() || !s.bankAccountNumber?.trim();
}

export function contactSchema(allowedRoles: readonly string[]) {
  return z
    .object({
      name: z.string().trim().min(1, "Name is required.").max(191),
      role: z
        .string()
        .trim()
        .refine((v) => !v || allowedRoles.includes(v), "Pick a role from the list.")
        .transform((v) => (v ? v : null)),
      email: z
        .string()
        .trim()
        .max(191)
        .refine((v) => !v || z.email().safeParse(v).success, "Enter a valid email.")
        .transform((v) => (v ? v.toLowerCase() : null)),
      phone: optionalText(64),
      isMain: z.boolean(),
    })
    .superRefine((v, ctx) => {
      if (!v.email && !v.phone) {
        ctx.addIssue({ code: "custom", path: ["email"], message: "Add an email or a phone number." });
      }
    });
}
export type ContactInput = z.infer<ReturnType<typeof contactSchema>>;
