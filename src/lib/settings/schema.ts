import { z } from "zod";
import { normalizeTin, TIN_FORMAT_MESSAGE } from "../validation/tin";

// Shape of one full settings snapshot (stored as JSON in SettingsVersion.data).
// Defaults live in ./defaults.ts and are only used to seed the first version.

const numberingFormat = z.object({
  prefix: z
    .string()
    .trim()
    .min(1, "Prefix is required.")
    .max(10, "Keep the prefix under 10 characters.")
    .regex(/^[A-Z0-9]+$/, "Use capital letters and numbers only."),
  padding: z.coerce.number().int().min(1, "At least 1 digit.").max(8, "At most 8 digits."),
  resetYearly: z.boolean(),
});

const listOfNames = z
  .array(z.string().trim().min(1).max(100))
  .min(1, "Add at least one option.")
  .refine((items) => new Set(items.map((i) => i.toLowerCase())).size === items.length, "Options must be unique.");

export const settingsSections = {
  approval: z.object({
    marginBelowPct: z.coerce.number().min(0, "0 or more.").max(100, "100 or less."),
    totalAbove: z.coerce.number().min(0, "0 or more."),
  }),
  quotes: z.object({
    defaultValidityDays: z.coerce.number().int().min(1, "At least 1 day.").max(365, "At most 365 days."),
  }),
  numbering: z.object({
    quote: numberingFormat,
    salesOrder: numberingFormat,
    supplierPo: numberingFormat,
    receivingReport: numberingFormat,
    billing: numberingFormat,
    collection: numberingFormat,
    supplierPayment: numberingFormat,
    expense: numberingFormat,
    cashTransfer: numberingFormat,
  }),
  taxYear: z
    .object({
      year: z.coerce.number().int().min(2000).max(2100),
      nonVatLimit: z.coerce.number().positive("Must be more than 0."),
      warnFirstPct: z.coerce.number().min(1).max(100),
      warnSecondPct: z.coerce.number().min(1).max(100),
    })
    .refine((v) => v.warnFirstPct < v.warnSecondPct, {
      message: "First warning must be lower than the second.",
      path: ["warnSecondPct"],
    }),
  company: z.object({
    name: z.string().trim().min(1, "Company name is required.").max(191),
    tin: z.string().transform((v, ctx) => {
      const tin = normalizeTin(v);
      if (tin === "invalid") {
        ctx.addIssue({ code: "custom", message: TIN_FORMAT_MESSAGE });
        return z.NEVER;
      }
      return tin ?? "";
    }),
    address: z.string().trim().max(500),
  }),
  lists: z.object({
    paymentTerms: listOfNames,
    contactRoles: listOfNames,
  }),
  documents: z.object({
    // Business documents (DTI, BIR 2303 …) show "Expires in N days" this many days ahead.
    expiryWarningDays: z.coerce.number().int().min(1, "At least 1 day.").max(365, "At most 365 days."),
  }),
  // Pre-printed sales-invoice booklet range. The app only *records* these numbers.
  invoiceBooklet: z
    .object({
      seriesFrom: z.coerce.number().int().min(1, "At least 1."),
      seriesTo: z.coerce.number().int().min(1, "At least 1."),
      label: z.string().trim().max(100).optional().or(z.literal("")),
    })
    .refine((v) => v.seriesTo >= v.seriesFrom, {
      message: "Series end must be at or after the start.",
      path: ["seriesTo"],
    }),
  collections: z.object({
    overdueGraceDays: z.coerce.number().int().min(0, "0 or more.").max(90, "At most 90 days."),
  }),
  // Feature flags (OFF by default). Staging: turn on here or set PAYABLES_ENABLED / CASH_ENABLED.
  features: z.object({
    payablesEnabled: z.boolean(),
    cashEnabled: z.boolean(),
  }),
} as const;

export const settingsSchema = z.object(settingsSections);

export type Settings = z.infer<typeof settingsSchema>;
export type SettingsKey = keyof typeof settingsSections;

export const SETTINGS_KEYS = Object.keys(settingsSections) as SettingsKey[];

/** Human labels used in the confirm dialog ("Change approval rules?") and change log. */
export const SETTINGS_LABELS: Record<SettingsKey, string> = {
  approval: "approval rules",
  quotes: "quote defaults",
  numbering: "numbering",
  taxYear: "tax year",
  company: "company details",
  lists: "lists",
  documents: "business documents",
  invoiceBooklet: "invoice booklet",
  collections: "collections",
  features: "features",
};

export function isSettingsKey(key: string): key is SettingsKey {
  return (SETTINGS_KEYS as string[]).includes(key);
}
