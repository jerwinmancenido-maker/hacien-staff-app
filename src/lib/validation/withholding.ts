import { z } from "zod";
import { pctToRate } from "../quotes/calc";

export const WITHHOLDING_LINE_KINDS = ["GOODS", "SERVICES", "GOV_PT", "GOV_VAT"] as const;
export type WithholdingLineKindValue = (typeof WITHHOLDING_LINE_KINDS)[number];

export const LINE_KIND_LABELS: Record<WithholdingLineKindValue, string> = {
  GOODS: "Goods lines",
  SERVICES: "Services lines",
  GOV_PT: "Whole total (gov. percentage tax)",
  GOV_VAT: "Whole total (gov. VAT)",
};

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .transform((v) => (v ? v : null));

export const withholdingRateRowSchema = z.object({
  id: z.string().trim().max(64).optional(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, "Code is required.")
    .max(32, "Keep the code under 32 characters.")
    .regex(/^[A-Z0-9_]+$/, "Use capital letters, numbers and _ only."),
  label: z.string().trim().min(1, "Label is required.").max(100),
  lineKind: z.enum(WITHHOLDING_LINE_KINDS, { error: "Pick what it applies to." }),
  atcCode: optional(20),
  /** Percent as typed, e.g. "1" or "1.5". Stored as a fraction (0.0150). */
  ratePct: z
    .string()
    .trim()
    .regex(/^\d{1,2}(\.\d{1,2})?$/, "Enter a percent like 1 or 1.5 (up to 2 decimals).")
    .refine((v) => Number(v) > 0 && Number(v) < 100, "Must be more than 0% and less than 100%.")
    .transform(pctToRate),
  active: z.boolean(),
  note: optional(255),
});

export const withholdingRatesSchema = z
  .array(withholdingRateRowSchema)
  .min(1, "Add at least one rate.")
  .superRefine((rows, ctx) => {
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      if (seen.has(r.code)) ctx.addIssue({ code: "custom", path: [i, "code"], message: "Codes must be unique." });
      seen.add(r.code);
    });
  });

export type WithholdingRateRowInput = z.infer<typeof withholdingRateRowSchema>;
