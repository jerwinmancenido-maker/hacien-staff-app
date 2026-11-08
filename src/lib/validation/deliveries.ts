import { z } from "zod";

const ymd = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.")
  .transform((s) => new Date(`${s}T00:00:00.000Z`));

const optionalYmd = z
  .string()
  .trim()
  .transform((v) => (v ? v : null))
  .pipe(z.union([ymd, z.null()]));

export const deliveryItemInputSchema = z.object({
  salesOrderItemId: z.string().min(1, "Item is required."),
  qty: z.string().trim(),
  // S-48: one serial per unit, typed comma- or newline-separated.
  serialNumbers: z.string().max(2000, "Keep serial numbers under 2000 characters.").optional().nullable(),
});

export const deliveryInputSchema = z.object({
  drNumber: z
    .string()
    .trim()
    .min(1, "DR number is required.")
    .max(64, "DR number is at most 64 characters."),
  deliveryDate: ymd,
  receivedBy: z
    .string()
    .trim()
    .max(191)
    .transform((v) => v || null)
    .nullable()
    .optional(),
  receivedDate: optionalYmd.optional(),
  notes: z
    .string()
    .trim()
    .max(2000, "Keep notes under 2000 characters.")
    .transform((v) => v || null)
    .nullable()
    .optional(),
  idSightChecked: z.coerce.boolean().default(false),
  items: z.array(deliveryItemInputSchema).default([]),
});

export type DeliveryInput = z.infer<typeof deliveryInputSchema>;
export type DeliveryItemInput = z.infer<typeof deliveryItemInputSchema>;

export function parseDeliveryForm(form: FormData):
  | { ok: true; data: DeliveryInput; values: Record<string, string> }
  | { ok: false; fieldErrors: Record<string, string>; values: Record<string, string> } {
  const itemIds = form.getAll("itemId").map(String);
  const itemQtys = form.getAll("itemQty").map(String);
  const itemSerials = form.getAll("itemSerials").map(String);
  const items: DeliveryItemInput[] = [];

  for (let i = 0; i < itemIds.length; i++) {
    const itemId = (itemIds[i] ?? "").trim();
    const qty = (itemQtys[i] ?? "").trim();
    const serialNumbers = itemSerials[i] ?? "";
    if (itemId) {
      items.push({ salesOrderItemId: itemId, qty, serialNumbers });
    }
  }

  const values: Record<string, string> = {
    drNumber: String(form.get("drNumber") ?? ""),
    deliveryDate: String(form.get("deliveryDate") ?? ""),
    receivedBy: String(form.get("receivedBy") ?? ""),
    receivedDate: String(form.get("receivedDate") ?? ""),
    notes: String(form.get("notes") ?? ""),
    idSightChecked: form.has("idSightChecked") ? "true" : "false",
  };

  const parsed = deliveryInputSchema.safeParse({
    ...values,
    idSightChecked: form.has("idSightChecked"),
    items,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join(".") || "_"] ??= issue.message;
    }
    return { ok: false, fieldErrors, values };
  }

  return { ok: true, data: parsed.data, values };
}
