// Non-VAT meter bar tone: accent below the first warn %, warning at first,
// danger at the second warn % / over. CSS maps these to --blue / --amber / --red.

import type { NonVatLevel } from "../services/non-vat";

export type NonVatBarTone = "accent" | "warning" | "danger";

/** Which fill token the Non-VAT progress bar should use for a meter level. */
export function nonVatBarTone(level: NonVatLevel): NonVatBarTone {
  if (level === "ok") return "accent";
  if (level === "first") return "warning";
  return "danger";
}

/**
 * Extra class on `.aging-bar-fill` for the home Non-VAT card.
 * Empty string → default fill is `var(--blue)` (brand accent).
 */
export function nonVatBarFillClass(level: NonVatLevel): "" | " amber" | " red" {
  const tone = nonVatBarTone(level);
  if (tone === "warning") return " amber";
  if (tone === "danger") return " red";
  return "";
}
