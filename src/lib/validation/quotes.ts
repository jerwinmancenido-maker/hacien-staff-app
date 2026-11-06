import { z } from "zod";
import {
  WITHHOLDING_PERCENT_NON_NUMERIC_ERROR,
  WITHHOLDING_PERCENT_RANGE_ERROR,
  isWithholdingRateInRange,
} from "../quotes/withholding-percent";
import { isUnchangedLegacyQuoteValidity, validityDaysFromDates } from "../quotes/validity";
import { docTotals, toScaled } from "../quotes/calc";

/** Shown when a quote total is ₱0 or less — on save and on mark-as-sent. */
export const QUOTE_ZERO_TOTAL_ERROR = "A quote total must be more than ₱0.";

/** Contract-price strings have 2 decimals; a total is savable only when above ₱0. */
export function quoteTotalIsPositive(total: string): boolean {
  return toScaled(total, 2) > 0n;
}

export const ITEM_KINDS = ["GOODS", "SERVICES"] as const;
export const ITEM_KIND_LABELS: Record<(typeof ITEM_KINDS)[number], string> = { GOODS: "Goods", SERVICES: "Services" };

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .transform((v) => (v ? v : null));

const optionalId = z
  .string()
  .trim()
  .max(64)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

/** Peso amount or quantity as typed: up to 10 whole digits and 2 decimals, commas allowed. */
const amount = (label: string, opts: { positive?: boolean } = {}) =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(/,/g, ""))
    .refine((v) => /^\d{1,10}(\.\d{1,2})?$/.test(v), `${label}: enter a number with up to 2 decimals.`)
    .refine((v) => !opts.positive || Number(v) > 0, `${label} must be more than 0.`);

/** YYYY-MM-DD → Date at 00:00 UTC (stored in DATE columns). */
export const dateOnly = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label}: pick a date.`)
    .transform((v, ctx) => {
      const d = new Date(`${v}T00:00:00.000Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
        ctx.addIssue({ code: "custom", message: `${label}: pick a valid date.` });
        return z.NEVER;
      }
      return d;
    });

export const itemSchema = z.object({
  id: optionalId,
  description: z.string().trim().min(1, "Description is required.").max(2000),
  kind: z.enum(ITEM_KINDS, { error: "Pick goods or services." }),
  qty: amount("Qty", { positive: true }),
  unit: z.string().trim().min(1, "Unit is required.").max(30),
  supplierId: optionalId,
  supplierUnitCost: amount("Supplier unit cost").optional().default("0"),
  unitPrice: amount("Unit price"),
  /** Snapshotted withholding fraction ("0.0100"); null = not snapshotted; omitted → server defaults. */
  withholdingRate: z
    .union([
      z.null(),
      z
        .string()
        .trim()
        .superRefine((v, ctx) => {
          if (!/^-?\d+(\.\d+)?$/.test(v)) {
            ctx.addIssue({ code: "custom", message: WITHHOLDING_PERCENT_NON_NUMERIC_ERROR });
            return;
          }
          if (!isWithholdingRateInRange(v)) {
            ctx.addIssue({ code: "custom", message: WITHHOLDING_PERCENT_RANGE_ERROR });
          }
        }),
    ])
    .optional(),
  withholdingAtc: z.string().trim().max(20).nullable().optional(),
  /** Explicit staff override vs the customer's usual default for this kind. */
  withholdingOverride: z.boolean().optional(),
});
export type ItemInput = z.infer<typeof itemSchema>;

const items = z.array(itemSchema).min(1, "Add at least one item.").max(200, "At most 200 items.");

const quoteInputObject = z.object({
    customerId: z.string().trim().min(1, "Pick a customer."),
    contactId: optionalId,
    date: dateOnly("Date"),
    /** Empty → date + Settings → Quote defaults validity days. */
    validUntil: z
      .string()
      .trim()
      .optional()
      .transform((v) => v || undefined)
      .pipe(dateOnly("Valid until").optional()),
    /** Validity days (minimum 1 day). */
    validForDays: z
      .coerce
      .number()
      .int("Must be a whole number of days.")
      .min(1, "At least 1 day.")
      .optional(),
    terms: optionalText(100),
    /** Customer notes — print on the quote. Existing data maps here. */
    notes: optionalText(5000),
    /** S-69: per-quote delivery / warranty notes. Empty = Settings default. */
    deliveryNotes: optionalText(1000)
      .optional()
      .transform((v) => v ?? null),
    warrantyNotes: optionalText(1000)
      .optional()
      .transform((v) => v ?? null),
    /** Staff-only. Never prints. Never on customer-facing pages. Omitted → null. */
    internalNotes: optionalText(5000)
      .optional()
      .transform((v) => v ?? null),
    /** Subject / project — prints when set. Omitted → null. */
    subject: optionalText(500)
      .optional()
      .transform((v) => v ?? null),
    /** Customer PO / RFQ no. — prints when set. Omitted → null. */
    buyerPoNo: optionalText(64)
      .optional()
      .transform((v) => v ?? null),
    /**
     * Preparer picker (2026-11-07): staff user printed under "Prepared by".
     * Omitted on update → keep the stored preparer; null → the creator.
     */
    preparedById: optionalId,
    /**
     * Quote-level withholding pick (codes from Settings → Withholding).
     * null = not set; [] = explicit none; [codes] = picks.
     * Omitted on update → keep the stored pick.
     */
    withholdingCodes: z.array(z.string().trim().min(1).max(32)).max(20).nullable().optional(),
    /**
     * When true with an empty/omitted withholdingCodes, treat the pick as
     * explicit none ([]). Used by the "Yes, none" confirm on submit.
     */
    withholdingExplicitNone: z.boolean().optional(),
    /** When true, non-override lines are re-snapshotted from the quote pick. */
    reapplyWithholding: z.boolean().optional(),
    items,
  })
  .refine((v) => !v.validUntil || v.validUntil >= v.date, { message: "Valid until can't be before the quote date.", path: ["validUntil"] })
  // S-78: a quote total of ₱0 or less can never be saved (create or edit).
  // Same math as the service stores (per-line qty × price, rounded to centavos).
  .refine((v) => quoteTotalIsPositive(docTotals(v.items).contractPrice), {
    message: QUOTE_ZERO_TOTAL_ERROR,
    path: ["items"],
  });

/** New quotes, and edits that change the quote date or valid-until. */
export const quoteInputSchema = quoteInputObject.refine(
  (v) => {
    if (!v.validUntil) return true;
    const days = validityDaysFromDates(v.date, v.validUntil);
    return days === null || days >= 1;
  },
  { message: "At least 1 day.", path: ["validUntil"] },
);

/**
 * Update only: the quote already has validUntil on its quote date, and this
 * save does not change either date. Same-day stays allowed so the quote can
 * still be saved.
 */
export const quoteUnchangedLegacyInputSchema = quoteInputObject;

export function quoteInputSchemaForSave(
  raw: unknown,
  stored: { date: string; validUntil: string } | null | undefined,
) {
  if (
    stored &&
    raw !== null &&
    typeof raw === "object" &&
    isUnchangedLegacyQuoteValidity(raw as { date?: unknown; validUntil?: unknown }, stored)
  ) {
    return quoteUnchangedLegacyInputSchema;
  }
  return quoteInputSchema;
}
/** Parsed quote write shape. New Phase 1 fields are optional so older callers/fixtures still typecheck. */
export type QuoteInput = Omit<z.infer<typeof quoteInputSchema>, "internalNotes" | "subject" | "buyerPoNo" | "deliveryNotes" | "warrantyNotes" | "preparedById"> & {
  internalNotes?: string | null;
  subject?: string | null;
  buyerPoNo?: string | null;
  deliveryNotes?: string | null;
  warrantyNotes?: string | null;
  validForDays?: number;
  /** Preparer picker: omitted → keep the stored preparer (create: the creator). */
  preparedById?: string | null;
};

export const convertInputSchema = z.object({
  buyerPoNo: optionalText(64).optional(),
  buyerPoDate: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined)
    .pipe(dateOnly("Buyer PO date").optional()),
  deliveryAddressId: optionalText(64).optional(),
  deliveryAddress: optionalText(1000).optional(),
});
export type ConvertInput = z.infer<typeof convertInputSchema>;

/** Audit (2026-11-05): customer acceptance on a quote — date, name, how. */
export const acceptanceInputSchema = z.object({
  acceptedAt: dateOnly("Acceptance date"),
  acceptedBy: z.string().trim().min(1, "Enter who accepted.").max(128, "Keep this under 128 characters."),
  acceptedVia: z.enum(["SIGNED_CONFORME", "EMAIL", "PHONE", "IN_PERSON"], { error: "Pick how the customer accepted." }),
});
export type AcceptanceInput = z.infer<typeof acceptanceInputSchema>;

export const salesOrderInputSchema = convertInputSchema.extend({
  contactId: optionalId,
  terms: optionalText(100),
  notes: optionalText(5000),
  philgepsRef: optionalText(64).optional(),
  bidNo: optionalText(64).optional(),
  noaDate: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined)
    .pipe(dateOnly("NOA date").optional()),
  agencyPoNo: optionalText(64).optional(),
  iarDate: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined)
    .pipe(dateOnly("IAR date").optional()),
  /** When true, non-override lines are re-snapshotted from the SO's stored rates / customer pick. */
  reapplyWithholding: z.boolean().optional(),
  /** Optional pick codes when re-applying from the customer's saved pick. */
  withholdingCodes: z.array(z.string().trim().min(1).max(32)).max(20).nullable().optional(),
  /** Required when an Admin changes a won sales order's prices, quantities, or total. */
  priceOverrideReason: z.string().trim().max(1000).optional(),
  items,
});
export type SalesOrderInput = z.infer<typeof salesOrderInputSchema>;

export const govDealInputSchema = z.object({
  philgepsRef: optionalText(64).optional(),
  bidNo: optionalText(64).optional(),
  noaDate: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined)
    .pipe(dateOnly("NOA date").optional()),
  agencyPoNo: optionalText(64).optional(),
  iarDate: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined)
    .pipe(dateOnly("IAR date").optional()),
});
export type GovDealInput = z.infer<typeof govDealInputSchema>;

export const voidReasonSchema = z.string().trim().min(3, "Give a reason (at least 3 characters).").max(1000);
