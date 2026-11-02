import { z } from "zod";
import { normalizeTin, TIN_FORMAT_MESSAGE } from "../validation/tin";

// Shape of one full settings snapshot (stored as JSON in SettingsVersion.data).
// Defaults live in ./defaults.ts and are only used to seed the first version.

const optionalDay = z.preprocess((v) => {
  if (v === null || v === undefined || v === "") return null;
  return v;
}, z.coerce.number().int().min(1).max(31).nullable());

const optionalMonth = z.preprocess((v) => {
  if (v === null || v === undefined || v === "") return null;
  return v;
}, z.coerce.number().int().min(1).max(12).nullable());

const taxCalendarObligationSettings = z.object({
  enabled: z.boolean(),
  /** Day of month (1–31), or null when undated / last-day-of-month. */
  dueDay: optionalDay,
  /** Month (1–12) for annual / undated overrides; null = catalog default. */
  dueMonth: optionalMonth,
});

const taxHoliday = z.object({
  ymd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD."),
  kind: z.enum(["regular", "special"]),
  name: z.string().trim().max(100).optional(),
});

const incomeTaxMethod = z.enum(["EIGHT_PERCENT", "GRADUATED"]);
const booksOfAccountsType = z.enum(["loose_leaf", "computerized"]).nullable();

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

const accountLast4 = z
  .string()
  .trim()
  .regex(/^\d{4}$/, "Enter the last 4 digits only.");

/** Full account number is optional; stored only when staff enter it. Never put in fixtures/logs. */
const accountNumberFull = z
  .string()
  .trim()
  .max(64)
  .regex(/^[\d\s-]*$/, "Use digits, spaces or dashes only.")
  .optional()
  .or(z.literal(""));

const paymentAccountBank = z.object({
  bankName: z.string().trim().min(1).max(100),
  accountName: z.string().trim().min(1).max(100),
  accountLast4,
  /** OFF by default — print ****last4. ON — print full number when entered. */
  printFullAccountNumber: z.boolean().default(false),
  accountNumberFull,
});

const paymentAccountEwallet = z.object({
  provider: z.string().trim().min(1).max(100),
  accountName: z.string().trim().min(1).max(100),
  accountLast4,
  printFullAccountNumber: z.boolean().default(false),
  accountNumberFull,
});

export const settingsSections = {
  approval: z.object({
    marginBelowPct: z.coerce.number().min(0, "0 or more.").max(100, "100 or less."),
    totalAbove: z.coerce.number().min(0, "0 or more."),
    /** PO subtotal strictly above this (₱, 2 dp) needs Approver/Admin sign-off. Default 100000. */
    poTotalAbove: z.coerce.number().min(0, "0 or more.").default(100_000),
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
      /**
       * Income tax method for `year`. Seed: 2026 = 8%; 2027 onward default Graduated.
       * Per-year history lives in incomeTaxMethodsByYear.
       */
      incomeTaxMethod: incomeTaxMethod.default("EIGHT_PERCENT"),
      incomeTaxMethodsByYear: z
        .record(z.string(), incomeTaxMethod)
        .default({})
        .superRefine((map, ctx) => {
          for (const key of Object.keys(map)) {
            if (!/^\d{4}$/.test(key)) {
              ctx.addIssue({
                code: "custom",
                message: `Income tax method year "${key}" must be a four-digit year (e.g. 2026).`,
                path: [key],
              });
              continue;
            }
            const y = Number(key);
            if (y < 2000 || y > 2100) {
              ctx.addIssue({
                code: "custom",
                message: `Income tax method year ${key} must be between 2000 and 2100.`,
                path: [key],
              });
            }
          }
        }),
      /** Editable PH holiday list used to roll tax due dates (RMC 65-2016). */
      holidays: z.array(taxHoliday).default([]),
      /**
       * Books of accounts type. Null → calendar shows “date to confirm”.
       * loose_leaf → Jan 15; computerized → Jan 30 (then rolled).
       */
      booksType: booksOfAccountsType.default(null),
    })
    .refine((v) => v.warnFirstPct < v.warnSecondPct, {
      message: "First warning must be lower than the second.",
      path: ["warnSecondPct"],
    })
    .transform((v) => {
      // Keep active-year method and map in sync on every successful parse.
      const map = { ...v.incomeTaxMethodsByYear, [String(v.year)]: v.incomeTaxMethod };
      return { ...v, incomeTaxMethodsByYear: map };
    }),
  company: z.object({
    /** Registered business name (letterhead). */
    name: z.string().trim().min(1, "Company name is required.").max(191),
    /** Trade / doing-business-as name shown under the registered name when set. */
    tradeName: z.string().trim().max(191).optional().or(z.literal("")),
    tin: z.string().transform((v, ctx) => {
      const tin = normalizeTin(v);
      if (tin === "invalid") {
        ctx.addIssue({ code: "custom", message: TIN_FORMAT_MESSAGE });
        return z.NEVER;
      }
      return tin ?? "";
    }),
    address: z.string().trim().max(500),
    phone: z.string().trim().max(40).optional().or(z.literal("")),
    email: z.string().trim().max(191).optional().or(z.literal("")),
    website: z.string().trim().max(191).optional().or(z.literal("")),
    /** Storage key for the uploaded logo (empty = show name). Served at /files/company-logo. */
    logoStorageKey: z.string().trim().max(64).optional().or(z.literal("")),
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
  // Feature flags (OFF by default). Staging: turn on here or set PAYABLES_ENABLED / CASH_ENABLED / BOOKS_ENABLED / PAYABLES_2307_ENABLED.
  features: z.object({
    payablesEnabled: z.boolean(),
    cashEnabled: z.boolean(),
    booksEnabled: z.boolean(),
    /** Issue supplier 2307s (withholding agent). OFF — HACIEN is not a withholding agent by default. */
    payables2307Enabled: z.boolean(),
  }),
  // Tax calendar. Owner-only via manage_settings.
  taxCalendar: z.object({
    /** When true, the provisional COR banner may be cleared. Default false. */
    corUploadedAndChecked: z.boolean(),
    obligations: z.object({
      "1701q": taxCalendarObligationSettings,
      "1701": taxCalendarObligationSettings,
      "1701a": taxCalendarObligationSettings,
      "2551q": taxCalendarObligationSettings,
      "2550q": taxCalendarObligationSettings,
      "0619e": taxCalendarObligationSettings,
      "1601eq": taxCalendarObligationSettings,
      books_accounts: taxCalendarObligationSettings,
      inventory_list: taxCalendarObligationSettings,
    }),
  }),
  // Print / PDF letterhead, paper size, and payment instructions.
  print: z.object({
    paperSize: z.enum(["A4", "Letter"]),
    /** Stored so older snapshots still parse. The input-tax line is no longer gated by this flag. */
    showInputTaxDisclaimer: z.boolean(),
    /**
     * When ON, receiving-report prints may show unit cost / amount — but only
     * for users with cost-view permission. Default OFF (qty-only).
     */
    showReceivingReportCosts: z.boolean(),
    quoteTerms: z.string().trim().max(2000).optional().or(z.literal("")),
    deliveryNotes: z.string().trim().max(2000).optional().or(z.literal("")),
    warrantyNotes: z.string().trim().max(2000).optional().or(z.literal("")),
    banks: z.array(paymentAccountBank).max(5),
    eWallets: z.array(paymentAccountEwallet).max(5),
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
  taxCalendar: "tax calendar",
  print: "print & company details",
};

export function isSettingsKey(key: string): key is SettingsKey {
  return (SETTINGS_KEYS as string[]).includes(key);
}
