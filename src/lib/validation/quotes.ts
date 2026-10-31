import { z } from "zod";
import {
  WITHHOLDING_PERCENT_NON_NUMERIC_ERROR,
  WITHHOLDING_PERCENT_RANGE_ERROR,
  isWithholdingRateInRange,
} from "../quotes/withholding-percent";

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

export const quoteInputSchema = z
  .object({
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
    terms: optionalText(100),
    /** Customer notes — print on the quote. Existing data maps here. */
    notes: optionalText(5000),
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
  .refine((v) => !v.validUntil || v.validUntil >= v.date, { message: "Valid until can't be before the quote date.", path: ["validUntil"] });
/** Parsed quote write shape. New Phase 1 fields are optional so older callers/fixtures still typecheck. */
export type QuoteInput = Omit<z.infer<typeof quoteInputSchema>, "internalNotes" | "subject" | "buyerPoNo"> & {
  internalNotes?: string | null;
  subject?: string | null;
  buyerPoNo?: string | null;
};

export const convertInputSchema = z.object({
  buyerPoNo: optionalText(64),
  buyerPoDate: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined)
    .pipe(dateOnly("Buyer PO date").optional()),
  deliveryAddress: optionalText(1000),
});
export type ConvertInput = z.infer<typeof convertInputSchema>;

export const salesOrderInputSchema = convertInputSchema.extend({
  contactId: optionalId,
  terms: optionalText(100),
  notes: optionalText(5000),
  /** When true, non-override lines are re-snapshotted from the SO's stored rates / customer pick. */
  reapplyWithholding: z.boolean().optional(),
  /** Optional pick codes when re-applying from the customer's saved pick. */
  withholdingCodes: z.array(z.string().trim().min(1).max(32)).max(20).nullable().optional(),
  items,
});
export type SalesOrderInput = z.infer<typeof salesOrderInputSchema>;

export const voidReasonSchema = z.string().trim().min(3, "Give a reason (at least 3 characters).").max(1000);
