import { z } from "zod";

/** Item catalog, Step 1 (Option A): the fields Miller approved 2026-11-07. */
export const ITEM_KINDS = ["GOODS", "SERVICES"] as const;
export type ItemKindValue = (typeof ITEM_KINDS)[number];
export const ITEM_KIND_LABELS: Record<ItemKindValue, string> = {
  GOODS: "Goods",
  SERVICES: "Services",
};

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .transform((v) => (v ? v : null));

/** Default unit price: blank = none; otherwise a peso amount, up to 2 decimals. */
const priceField = z
  .string()
  .trim()
  .transform((v) => v.replace(/,/g, ""))
  .refine((v) => v === "" || /^\d{1,10}(\.\d{1,2})?$/.test(v), "Enter a peso amount with up to 2 decimals.")
  .transform((v) => (v === "" ? null : v))
  .optional();

export function itemSchema() {
  return z.object({
    name: z.string().trim().min(1, "Name is required.").max(191),
    brand: optionalText(120),
    model: optionalText(120),
    category: optionalText(120),
    sku: optionalText(60),
    unit: z.string().trim().min(1, "Unit is required.").max(30),
    kind: z.enum(ITEM_KINDS, { error: "Pick Goods or Services." }),
    details: optionalText(5000),
    defaultUnitPrice: priceField,
  });
}
export type ItemInput = z.infer<ReturnType<typeof itemSchema>>;
