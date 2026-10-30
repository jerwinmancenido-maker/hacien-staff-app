import { z } from "zod";
import { dateOnly, ITEM_KINDS } from "./quotes";

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

const optionalDate = (label: string) =>
  z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => v || undefined)
    .pipe(dateOnly(label).optional())
    .transform((v) => v ?? null);

/** Peso amount or quantity as typed: up to 10 whole digits and 2 decimals, commas allowed. */
const amount = (label: string, opts: { positive?: boolean } = {}) =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(/,/g, ""))
    .refine((v) => /^\d{1,10}(\.\d{1,2})?$/.test(v), `${label}: enter a number with up to 2 decimals.`)
    .refine((v) => !opts.positive || Number(v) > 0, `${label} must be more than 0.`);

export const poLineSchema = z.object({
  id: optionalId,
  description: z.string().trim().min(1, "Description is required.").max(2000),
  kind: z.enum(ITEM_KINDS, { error: "Pick goods or services." }),
  qty: amount("Qty", { positive: true }),
  unit: z.string().trim().min(1, "Unit is required.").max(30),
  unitCost: amount("Unit cost"),
});
export type PoLineInput = z.infer<typeof poLineSchema>;

export const poInputSchema = z
  .object({
    supplierId: z.string().trim().min(1, "Pick a supplier."),
    supplierContactId: optionalId,
    date: dateOnly("PO date"),
    expectedDate: optionalDate("Expected date"),
    terms: optionalText(100),
    deliveryAddressText: optionalText(1000),
    supplierAddressText: optionalText(1000),
    notes: optionalText(5000),
    items: z.array(poLineSchema).min(1, "Add at least one item.").max(200, "At most 200 items."),
  })
  .refine((v) => !v.expectedDate || v.expectedDate >= v.date, { message: "Expected date can't be before the PO date.", path: ["expectedDate"] });
export type PoInput = z.infer<typeof poInputSchema>;

export const createFromSoSchema = z
  .object({
    date: dateOnly("PO date"),
    expectedDate: optionalDate("Expected date"),
    deliveryAddressText: optionalText(1000),
    /** SO line id → supplier picked in the preview (for lines without one). */
    supplierPicks: z.record(z.string().max(64), z.string().max(64).nullable()).default({}),
    /** SO lines to include (unticked ones are skipped). Omitted = all. */
    lineIds: z.array(z.string().max(64)).max(500).optional(),
  })
  .refine((v) => !v.expectedDate || v.expectedDate >= v.date, { message: "Expected date can't be before the PO date.", path: ["expectedDate"] });
export type CreateFromSoInput = z.infer<typeof createFromSoSchema>;

export const receiptInputSchema = z.object({
  receivedDate: dateOnly("Received date"),
  receivedById: z.string().trim().min(1, "Pick who received the items.").max(64),
  deliveryRef: optionalText(64),
  notes: optionalText(5000),
  lines: z.array(z.object({ lineId: z.string().max(64), qty: z.string().max(20) })).max(500),
});
export type ReceiptInput = z.infer<typeof receiptInputSchema>;

export const billInputSchema = z.object({
  billNumber: z.string().trim().min(1, "Enter the supplier's bill / invoice no.").max(64),
  billDate: dateOnly("Bill date"),
  amount: amount("Amount", { positive: true }),
  notes: optionalText(5000),
  lines: z
    .array(z.object({ purchaseOrderItemId: z.string().max(64), qty: z.string().max(20), unitPrice: z.string().max(20) }))
    .max(500)
    .default([]),
});
export type BillInput = z.infer<typeof billInputSchema>;

export const closeReasonSchema = z.string().trim().max(1000);
