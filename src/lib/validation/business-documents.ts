import { z } from "zod";
import { BUSINESS_DOC_TYPES } from "../business-docs/types";
import { dateOnly } from "./quotes";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .transform((v) => (v ? v : null));

const optionalDate = (label: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined)
    .pipe(dateOnly(label).optional())
    .transform((v) => v ?? null);

export const businessDocumentMetaSchema = z
  .object({
    type: z.enum(BUSINESS_DOC_TYPES, { error: "Pick a document type." }),
    otherLabel: optionalText(100),
    docNumber: optionalText(100),
    issueDate: optionalDate("Issue date"),
    expiryDate: optionalDate("Expiry date"),
    replacesId: optionalText(64),
  })
  .superRefine((v, ctx) => {
    if (v.type === "OTHER" && !v.otherLabel) ctx.addIssue({ code: "custom", path: ["otherLabel"], message: "Say what kind of document this is." });
    if (v.issueDate && v.expiryDate && v.expiryDate < v.issueDate) {
      ctx.addIssue({ code: "custom", path: ["expiryDate"], message: "Expiry can't be before the issue date." });
    }
  });
export type BusinessDocumentMeta = z.infer<typeof businessDocumentMetaSchema>;
