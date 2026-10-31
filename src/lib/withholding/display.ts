// Staff-facing labels for the customer withholding-type form.
// Display only — stored enum values never change here.

import type { WithholdingTypeValue } from "@/lib/validation/companies";

/** Customer form field label for withholding type (stored enum unchanged). */
export const WITHHOLDING_TYPE_FIELD_LABEL = "Does this customer withhold tax from your payment?";

/** Hint under the withholding type field when the customer withholds (TWA / Government). */
export const WITHHOLDING_TYPE_FIELD_HINT = "They'll give you a BIR 2307";

/**
 * Form option labels for Customer.withholdingType.
 * Keys are the stored enum values — do not rename keys.
 */
export const WITHHOLDING_TYPE_FORM_LABELS: Record<WithholdingTypeValue, string> = {
  NONE: "No, pays in full (most customers)",
  TOP_WITHHOLDING_AGENT: "Yes, Top Withholding Agent (big company tagged by BIR)",
  GOVERNMENT: "Yes, Government office",
};

/** Form option order (stored values unchanged). */
export const WITHHOLDING_TYPE_FORM_ORDER: readonly WithholdingTypeValue[] = [
  "NONE",
  "TOP_WITHHOLDING_AGENT",
  "GOVERNMENT",
];

/**
 * BIR 2307 hint only when the customer withholds (TWA or Government).
 * Never show it for "No, pays in full" (NONE) or an empty pick.
 */
export function withholdingTypeFieldHint(type: string): string | null {
  if (type === "TOP_WITHHOLDING_AGENT" || type === "GOVERNMENT") return WITHHOLDING_TYPE_FIELD_HINT;
  return null;
}
