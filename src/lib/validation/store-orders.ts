import { z } from "zod";

/**
 * Store-order conversion input (Slice 2). The booklet SI number is a
 * REQUIRED staff input (Gap 2) — the dialog may pre-fill the lowest
 * unclaimed in-band number, but staff can overwrite it and nothing is
 * ever claimed until the conversion transaction runs.
 */
export const convertStoreOrderInputSchema = z.object({
  customerMode: z.enum(["matched", "existing", "new"]),
  customerId: z.string().trim().min(1).nullish(),
  isIndividual: z.boolean().optional(),
  invoiceNo: z.number().int().positive("Enter the booklet SI number."),
  lineItemPicks: z.record(z.string(), z.string().nullable()).default({}),
});

export type ConvertStoreOrderInputParsed = z.infer<typeof convertStoreOrderInputSchema>;
