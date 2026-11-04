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

/** Digits, +, spaces and dashes. Tabs and other whitespace are not spaces. */
export const PHONE_PATTERN = /^[0-9+ -]+$/;
export const PHONE_FORMAT_MESSAGE = "Only digits, +, spaces and dashes allowed.";

export const phoneField = (max = 64) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .refine((v) => !v || PHONE_PATTERN.test(v), PHONE_FORMAT_MESSAGE)
    .transform((v) => (v ? v : null));

/** Default terms must be one of the options in Settings → Lists (or empty). */
function termsField(allowedTerms: readonly string[]) {
  return z
    .string()
    .trim()
    .refine((v) => !v || allowedTerms.includes(v), "Pick terms from the list.")
    .transform((v) => (v ? v : null));
}

/** Payment terms must be one of the options in Settings → Lists. */
function requiredTermsField(allowedTerms: readonly string[]) {
  return z
    .string()
    .trim()
    .min(1, "Payment terms are required.")
    .refine((v) => allowedTerms.includes(v), "Pick terms from the list.");
}

/**
 * `allowedWithholdingCodes`: active rate codes staff may tick on
 * Customer.defaultWithholding. Omit to skip the check, e.g. in tests.
 *
 * defaultWithholding semantics:
 *   null  = not set
 *   []    = explicit none
 *   [codes] = saved picks
 */
/**
 * `termsRequired` is false only when updating a customer who still has no terms,
 * so staff can edit that record without inventing terms. New customers always require them.
 */
export function customerSchema(
  allowedTerms: readonly string[],
  allowedWithholdingCodes?: readonly string[],
  termsRequired = true,
) {
  return z
    .object({
      name: z.string().trim().min(1, "Name is required.").max(191),
      tin: tinField,
      // Label only — does not choose rates.
      withholdingType: z.enum(WITHHOLDING_TYPES, { error: "Pick a withholding type." }),
      // null / omitted = not set — rejected on save (never silently stored as "No" / []).
      // [] = explicit none; [codes] = saved picks.
      defaultWithholding: z
        .union([
          z.null(),
          z
            .array(z.string().trim().min(1).max(32))
            .max(20)
            .refine((codes) => !allowedWithholdingCodes || codes.every((c) => allowedWithholdingCodes.includes(c)), "Pick rates from the list.")
            .transform((codes) => [...new Set(codes)]),
        ])
        .optional(),
      defaultTerms: termsRequired ? requiredTermsField(allowedTerms) : termsField(allowedTerms),
      // S-54: blank = no limit; otherwise a non-negative peso amount.
      creditLimit: z
        .string()
        .trim()
        .transform((v) => v.replace(/,/g, ""))
        .refine((v) => v === "" || /^\d{1,10}(\.\d{1,2})?$/.test(v), "Credit limit: enter a peso amount with up to 2 decimals.")
        .transform((v) => (v === "" ? null : v))
        .optional(),
      notes: optionalText(5000),
      // Q16 S-95: on by default; a missing value (older posts) stays on.
      // Optional on input; saveCustomer defaults it to true (and the DB
      // column defaults to true), so older callers omitting it still pass.
      orderTextUpdates: z.boolean().optional(),
    })
    .superRefine((v, ctx) => {
      if (v.defaultWithholding == null) {
        ctx.addIssue({
          code: "custom",
          path: ["defaultWithholding"],
          message: "Pick withholding rates, or choose No withholding.",
        });
      }
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
      phone: phoneField(64),
      isMain: z.boolean(),
      // Q17 S-96: marketing consent, unticked by default. Optional so older
      // callers (tests, other forms) keep working; the service defaults OFF.
      marketingEmailConsent: z.boolean().optional(),
      marketingSmsConsent: z.boolean().optional(),
    })
    .superRefine((v, ctx) => {
      if (!v.email && !v.phone) {
        ctx.addIssue({ code: "custom", path: ["email"], message: "Add an email or a phone number." });
      }
    });
}
export type ContactInput = z.infer<ReturnType<typeof contactSchema>>;
