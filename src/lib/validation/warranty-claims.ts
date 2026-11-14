// Phase 3 #8b: warranty claim form inputs.

import { z } from "zod";
import { WARRANTY_CLAIM_STATUSES } from "../purchasing/warranty-claims-shared";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const createWarrantyClaimSchema = z.object({
  serialNumber: optionalText(100),
  fault: z.string().trim().min(1, "Describe what is wrong with the item.").max(2000, "Keep the fault description under 2000 characters."),
  supplierRef: optionalText(64),
});

export type CreateWarrantyClaimInput = z.infer<typeof createWarrantyClaimSchema>;

export const warrantyClaimStatusSchema = z.enum(WARRANTY_CLAIM_STATUSES);
