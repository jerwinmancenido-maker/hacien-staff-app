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

/**
 * One named payment-term preset (ERP adoption item 10). `text` is capped
 * at 100 chars because that is the Quote / SO terms field's own limit —
 * a preset must always fit the field it fills.
 */
export const paymentTermPresetSchema = z.object({
  name: z.string().trim().min(1, "Give the preset a name.").max(60),
  text: z.string().trim().min(1, "Write the terms text the preset fills in.").max(100),
  active: z.boolean(),
});

export type PaymentTermPreset = z.infer<typeof paymentTermPresetSchema>;

export const paymentTermPresetsSchema = z
  .array(paymentTermPresetSchema)
  .max(30, "At most 30 presets.")
  .refine(
    (items) => new Set(items.map((i) => i.name.toLowerCase())).size === items.length,
    "Preset names must be unique.",
  );

/**
 * Seed presets. The texts are the long-standing lists.paymentTerms
 * strings verbatim (pinned equal by tests against DEFAULT_SETTINGS), so
 * a document filled from a preset prints exactly what the same terms
 * string prints today. The names "COD", "50/50" and "Net 30" are the
 * keys item 14's printed schedule table will match on — do not rename.
 */
export const PAYMENT_TERM_PRESET_SEED: PaymentTermPreset[] = [
  { name: "COD", text: "COD", active: true },
  { name: "50/50", text: "50% down, 50% on delivery", active: true },
  { name: "Net 30", text: "Net 30 (approved accounts only)", active: true },
  { name: "100% upfront", text: "100% upfront (software and special orders)", active: true },
];

/** The presets an editor may offer: active ones only, in saved order. */
export function activePaymentTermPresets(presets: readonly PaymentTermPreset[]): PaymentTermPreset[] {
  return presets.filter((p) => p.active);
}

const accountLast4 = z
  .string()
  .trim()
  .regex(/^\d{4}$/, "Enter the last 4 digits only.");

/** Full account number is optional; stored only when staff enter it. Never put in fixtures/logs. */

const legalText = z
  .string()
  .trim()
  .min(1, "Wording can't be blank.")
  .max(2000);
const accountNumberFull = z
  .string()
  .trim()
  .max(64)
  .regex(/^[\d\s-]*$/, "Use digits, spaces or dashes only.")
  .optional()
  .or(z.literal(""));

const paymentAccountBank = z.object({
  // F27: friendly messages — a bare .min(1) surfaced raw Zod text
  // ("Too small: expected string to have >=1 characters").
  bankName: z.string().trim().min(1, "Enter the bank name.").max(100),
  accountName: z.string().trim().min(1, "Enter the account name.").max(100),
  accountLast4,
  /** OFF by default — print ****last4. ON — print full number when entered. */
  printFullAccountNumber: z.boolean().default(false),
  accountNumberFull,
});

const paymentAccountEwallet = z.object({
  provider: z.string().trim().min(1, "Enter the provider.").max(100),
  accountName: z.string().trim().min(1, "Enter the account name.").max(100),
  accountLast4,
  printFullAccountNumber: z.boolean().default(false),
  accountNumberFull,
});

const alertRole = z.enum(["admin", "approver", "staff"]);

const alertEmailAddress = z
  .string()
  .trim()
  .min(3, "Enter a valid email address.")
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email address.");

/**
 * One email alert rule (ERP adoption item 8). The channel is part of the
 * stored shape so a chat channel can be added later without reshaping the
 * data — today "email" is the only value: there is no chat/Telegram
 * integration in this app, and adding one needs a bot key (a secret).
 */
const alertRule = z.object({
  enabled: z.boolean(),
  channel: z.literal("email").default("email"),
  roles: z.array(alertRole).max(3, "At most 3 roles."),
  emails: z.array(alertEmailAddress).max(20, "At most 20 extra addresses."),
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
    storeOrder: numberingFormat,
  }),
  taxYear: z
    .object({
      year: z.coerce.number().int().min(2000).max(2100),
      nonVatLimit: z.coerce.number().positive("Must be more than 0."),
      /**
       * VAT posture in one place (Company Profile slice 1). Seed false —
       * HACIEN is NON-VAT on the 8% option; mirrors BUSINESS_IS_VAT_REGISTERED
       * in src/lib/tax/constants.ts until a later slice reads it from here.
       */
      isVatRegistered: z.boolean().default(false),
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
    /**
     * Named payment-term presets (ERP adoption item 10): a preset is a
     * typing shortcut in the Quote / SO editors — picking one fills the
     * document's terms field with the preset's text, and the document
     * stores ONLY that text (no preset id), so editing a preset later
     * never rewrites an issued document. Item 14 keys its printed
     * schedule table on the preset NAMES "COD", "50/50" and "Net 30" —
     * keep those three names exact. The seed texts are the long-standing
     * lists.paymentTerms strings, so each resolves through
     * resolvePaymentTerm to the same printed Point 2 wording as today:
     * "COD" → COD, "50% down…" → FIFTY_FIFTY, "Net 30…" → NET30,
     * "100% upfront…" → UPFRONT.
     */
    paymentTermPresets: paymentTermPresetsSchema.default(PAYMENT_TERM_PRESET_SEED),
  }),
  documents: z.object({
    // Business documents (DTI, BIR 2303 …) show "Expires in N days" this many days ahead.
    expiryWarningDays: z.coerce.number().int().min(1, "At least 1 day.").max(365, "At most 365 days."),
  }),
  // Pre-printed booklet settings (ATP) per document type (SI, DR, CR).
  invoiceBooklet: z
    .object({
      seriesFrom: z.coerce.number().int().min(1, "At least 1.").default(1),
      seriesTo: z.coerce.number().int().min(1, "At least 1.").default(500),
      label: z.string().trim().max(100).optional().or(z.literal("")),
      atpNo: z.string().trim().max(100).default(""),
      atpDate: z.string().trim().default(""),
      printer: z.string().trim().max(191).default(""),
      bookletCount: z.coerce.number().int().min(1).default(10),
      setsPerBooklet: z.coerce.number().int().min(1).default(50),
      isNonVat: z.boolean().default(true),
      salesInvoice: z
        .object({
          atpNo: z.string().trim().max(100).default(""),
          atpDate: z.string().trim().default(""),
          printer: z.string().trim().max(191).default(""),
          seriesFrom: z.coerce.number().int().min(1, "At least 1.").default(1),
          seriesTo: z.coerce.number().int().min(1, "At least 1.").default(500),
          bookletCount: z.coerce.number().int().min(1, "At least 1.").default(10),
          setsPerBooklet: z.coerce.number().int().min(1, "At least 1.").default(50),
          isNonVat: z.boolean().default(true),
        })
        .default({
          atpNo: "",
          atpDate: "",
          printer: "",
          seriesFrom: 1,
          seriesTo: 500,
          bookletCount: 10,
          setsPerBooklet: 50,
          isNonVat: true,
        }),
      deliveryReceipt: z
        .object({
          atpNo: z.string().trim().max(100).default(""),
          atpDate: z.string().trim().default(""),
          printer: z.string().trim().max(191).default(""),
          seriesFrom: z.coerce.number().int().min(1, "At least 1.").default(1),
          seriesTo: z.coerce.number().int().min(1, "At least 1.").default(500),
          bookletCount: z.coerce.number().int().min(1, "At least 1.").default(10),
          setsPerBooklet: z.coerce.number().int().min(1, "At least 1.").default(50),
          isNonVat: z.boolean().default(true),
        })
        .default({
          atpNo: "",
          atpDate: "",
          printer: "",
          seriesFrom: 1,
          seriesTo: 500,
          bookletCount: 10,
          setsPerBooklet: 50,
          isNonVat: true,
        }),
      collectionReceipt: z
        .object({
          atpNo: z.string().trim().max(100).default(""),
          atpDate: z.string().trim().default(""),
          printer: z.string().trim().max(191).default(""),
          seriesFrom: z.coerce.number().int().min(1, "At least 1.").default(1),
          seriesTo: z.coerce.number().int().min(1, "At least 1.").default(500),
          bookletCount: z.coerce.number().int().min(1, "At least 1.").default(10),
          setsPerBooklet: z.coerce.number().int().min(1, "At least 1.").default(50),
          isNonVat: z.boolean().default(true),
        })
        .default({
          atpNo: "",
          atpDate: "",
          printer: "",
          seriesFrom: 1,
          seriesTo: 500,
          bookletCount: 10,
          setsPerBooklet: 50,
          isNonVat: true,
        }),
    })
    .superRefine((v, ctx) => {
      if (v.seriesTo < v.seriesFrom) {
        ctx.addIssue({ code: "custom", message: "Series end must be at or after the start.", path: ["seriesTo"] });
      }
      for (const key of ["salesInvoice", "deliveryReceipt", "collectionReceipt"] as const) {
        const r = v[key];
        if (r.seriesTo < r.seriesFrom) {
          ctx.addIssue({
            code: "custom",
            message: "Series end must be at or after the start.",
            path: [key, "seriesTo"],
          });
        }
      }
    })
    .transform((v) => {
      // Synchronize top-level seriesFrom/seriesTo with salesInvoice
      const si = { ...v.salesInvoice };
      if (v.seriesFrom !== 1 || v.seriesTo !== 500) {
        if (si.seriesFrom === 1 && si.seriesTo === 500) {
          si.seriesFrom = v.seriesFrom;
          si.seriesTo = v.seriesTo;
        }
      }
      return {
        ...v,
        seriesFrom: si.seriesFrom,
        seriesTo: si.seriesTo,
        salesInvoice: si,
      };
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
    /** Phase 3 #8b: supplier warranty claims on receiving lines. OFF by default. */
    warrantyClaimsEnabled: z.boolean().default(false),
    /** Phase 4 #4: CSV import for the Item catalog. OFF by default. */
    itemsImportEnabled: z.boolean().default(false),
    /** Phase 4 #10: period close controls on the Books page. OFF by default. */
    periodCloseEnabled: z.boolean().default(false),
    /** Adoption item 5: goods-received team email. ON by default. */
    receivingEmailEnabled: z.boolean().default(true),
    /** Adoption item 16: payment-received email to the customer, one per billing settled. ON by default. */
    customerPaymentEmailEnabled: z.boolean().default(true),
    /** Adoption item 16: delivery-recorded email to the customer. ON by default. */
    customerDeliveryEmailEnabled: z.boolean().default(true),
  }),
  // Adoption item 8: email alert rules — one rule per event. Alerts only:
  // an alert never carries an action; approvals stay in the app.
  alerts: z.object({
    goodsReceived: alertRule,
    supplierPayment: alertRule,
    collection: alertRule,
    quoteApproved: alertRule,
    salesOrderConfirmed: alertRule,
  }),
  // Q16 S-95: order text updates, Admin toggles on the Messages page.
  // Default chosen: ALL OFF until UniSMS keys, the UniSMS DPA + DB location,
  // and the HACIEN sender ID are confirmed. Turning a template on alone does
  // not send anything while orderTextsEnabled is false.
  messaging: z.object({
    orderTextsEnabled: z.boolean(),
    orderConfirmed: z.boolean(),
    orderDelivered: z.boolean(),
    orderPayment: z.boolean(),
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
  // Company identity edges (Company Profile slice 1). Seeded with today's
  // hard-coded values; surfaces still read the code constants until the
  // later slices wire them here.
  identity: z.object({
    /** Policies page the quote/SO prints link to (QR + link). */
    policiesUrl: z.string().trim().min(1, "Policies URL is required.").max(191),
    /** The same link as shown in print footers. */
    policiesDisplayHost: z.string().trim().min(1, "Policies display host is required.").max(191),
    /** "Terms of Sale v1.1 · …" footer line on customer-facing prints. */
    policyVersionLine: z.string().trim().min(1, "Policy version line is required.").max(500),
    /** Default SMS sender ID; env UNISMS_SENDER_ID still overrides at send time. */
    smsSenderId: z.string().trim().min(1, "SMS sender ID is required.").max(40),
    /** Download filename prefix for CSV exports ("" = no prefix). */
    csvFilePrefix: z.string().trim().max(40),
    /** Browser tab title; also the installed app's full name. */
    appTitle: z.string().trim().min(1, "App title is required.").max(100),
    /** Installed app's short name. */
    appShortName: z.string().trim().min(1, "App short name is required.").max(50),
  }),
  // Settled print legal texts, stored as values (Company Profile slice 1).
  // Seeded word-for-word from src/lib/print/tax-wording.ts and
  // src/lib/print/terms-block.ts — the tests pin them against those modules.
  // Surfaces still read the code constants until slice 2 wires them here.
  // Lawyer-governed: text changes need Jerwin's approval + legal
  // verification (BIR-WORDING.md rule 3). The terms templates keep their
  // {days} placeholder, substituted exactly as the terms-block functions do.
  wording: z.object({
    nonVatLabel: legalText,
    inputTaxDisclaimer: legalText,
    billingDisclaimer: legalText,
    packingListDisclaimer: legalText,
    ewt2307Note: legalText,
    thankYou: legalText,
    quotationNotInvoice: legalText,
    salesOrderNotInvoice: legalText,
    termsHeading: legalText,
    termsPoint1ValidityDefault: legalText,
    termsPoint1ValidityCustom: legalText,
    termsPoint1Body: legalText,
    termsPoint2Upfront: legalText,
    termsPoint2FiftyFifty: legalText,
    termsPoint2Net30: legalText,
    termsPoint2Cod: legalText,
    termsPaymentAntiFraud: legalText,
    termsCustomTermsAntiFraud: legalText,
    termsPoint3WithLeadTime: legalText,
    termsPoint3NoLeadTime: legalText,
    termsPoint4: legalText,
    termsPoint5Goods: legalText,
    termsPoint5Services: legalText,
    termsPoint6: legalText,
    termsPoint7: legalText,
    /** The 24 in point 7's "24% interest a year" (also inside termsPoint7). */
    termsLateInterestPctPerYear: z.coerce.number().min(0, "0 or more.").max(100, "100 or less."),
    /** The 25 in point 7's "25% attorney's fees" (also inside termsPoint7). */
    termsAttorneysFeesPct: z.coerce.number().min(0, "0 or more.").max(100, "100 or less."),
  }),
  // Print / PDF letterhead, paper size, and payment instructions.
  print: z.object({
    paperSize: z.enum(["A4", "Letter"]),
    /** Stored so older snapshots still parse without error. The input-tax line is always on. */
    showInputTaxDisclaimer: z.boolean().optional(),
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
  alerts: "email alerts",
  messaging: "order text updates",
  taxCalendar: "tax calendar",
  print: "print & company details",
  identity: "app identity",
  wording: "print wording",
};

export function isSettingsKey(key: string): key is SettingsKey {
  return (SETTINGS_KEYS as string[]).includes(key);
}

export const ALERT_EVENT_KEYS = [
  "goodsReceived",
  "supplierPayment",
  "collection",
  "quoteApproved",
  "salesOrderConfirmed",
] as const;
export type AlertEventKey = (typeof ALERT_EVENT_KEYS)[number];
export type AlertRole = z.infer<typeof alertRole>;
export type AlertRule = Settings["alerts"][AlertEventKey];

/** Labels + help for the Settings "Email alerts" form and audit text. */
export const ALERT_EVENTS: readonly { key: AlertEventKey; label: string; help: string }[] = [
  {
    key: "goodsReceived",
    label: "Goods received",
    help: "When a receiving report is posted for a purchase order. The PO's creator always gets this one too, on top of the roles and addresses below.",
  },
  {
    key: "supplierPayment",
    label: "Supplier payment recorded",
    help: "When a payment to a supplier is recorded.",
  },
  {
    key: "collection",
    label: "Collection recorded",
    help: "When a customer collection (payment received) is recorded.",
  },
  {
    key: "quoteApproved",
    label: "Quote approved",
    help: "When a quote's approval is granted.",
  },
  {
    key: "salesOrderConfirmed",
    label: "Sales order confirmed",
    help: "When a quote is converted into a sales order.",
  },
];
