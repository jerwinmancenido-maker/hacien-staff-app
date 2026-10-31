// Pure scaled-decimal math for tax worksheets. Never uses floating-point for
// money. All peso amounts are 2-decimal strings; rates are 4-decimal fractions.

import { fromScaled, toScaled } from "../quotes/calc";
import {
  ALLOWANCE_8PCT_LABEL,
  ALLOWANCE_8PCT_PESOS,
  INCOME_TAX_RATE_8PCT,
  NON_VAT_THRESHOLD_PESOS,
} from "./constants";

/** Sum peso strings with scaled decimals. */
export function sumPesos(amounts: readonly string[]): string {
  let total = 0n;
  for (const a of amounts) total += toScaled(a || "0", 2);
  return fromScaled(total, 2);
}

/** max(0, a − b) in pesos. */
export function pesosMaxZeroDiff(a: string, b: string): string {
  const diff = toScaled(a, 2) - toScaled(b, 2);
  return fromScaled(diff < 0n ? 0n : diff, 2);
}

/** a − b − c (may be negative = overpayment). */
export function pesosDiff(a: string, b: string, c: string = "0.00"): string {
  return fromScaled(toScaled(a, 2) - toScaled(b, 2) - toScaled(c, 2), 2);
}

/** Multiply a peso amount by a 4-decimal rate fraction (e.g. 0.0800). Half-up. */
export function pesosTimesRate(amount: string, rate: string): string {
  const a = toScaled(amount, 2);
  const r = toScaled(rate, 4);
  // (a/100) * (r/10000) = a*r / 1_000_000 → result scale 2 ⇒ a*r / 10_000
  const num = a * r;
  const denom = 10_000n;
  const q = num / denom;
  const rem = num % denom;
  const rounded = rem * 2n >= denom ? q + 1n : q;
  return fromScaled(rounded, 2);
}

/**
 * Tax base from tax withheld and rate: base = tax / rate.
 * Returns "0.00" when rate is zero (cannot invert).
 */
export function incomeBaseFromTax(tax: string, rate: string): string {
  const t = toScaled(tax, 2);
  const r = toScaled(rate, 4);
  if (r === 0n) return "0.00";
  // base = tax / rate → scale-2 result = t * 10^4 / r (half-up)
  const num = t * 10_000n;
  const q = num / r;
  const rem = num % r;
  const rounded = rem * 2n >= r ? q + 1n : q;
  return fromScaled(rounded, 2);
}

export type IncomeTax1701qLines = {
  /** (a) Cumulative figure used for this column (invoiced or collected — never a combined total). */
  a: string;
  /** (b) ₱250k allowance (configurable constant). */
  b: string;
  /** (c) max(0, a−b). */
  c: string;
  /** (d) c × 8%. */
  d: string;
  /** (e) Tax paid in earlier quarters (manual sum). */
  e: string;
  /** (f) Creditable withholding from customer 2307s / collections EWT. */
  f: string;
  /** (g) d − e − f (payable or overpayment). */
  g: string;
  /** True when a > ₱3,000,000. */
  overThreshold: boolean;
  rate: string;
  allowanceLabel: string;
};

/**
 * Build 1701Q (8% option) worksheet lines from one cumulative figure.
 * Pure — no I/O. Callers pass invoiced and collected separately and must not
 * combine sales+collections into a single chosen basis.
 */
export function build1701qWorksheet(input: {
  cumulativeGrossSales: string;
  taxPaidEarlierQuarters: string;
  creditableWithholding: string;
  allowance?: string;
  rate?: string;
  threshold?: string;
}): IncomeTax1701qLines {
  const a = fromScaled(toScaled(input.cumulativeGrossSales || "0", 2), 2);
  const b = fromScaled(toScaled(input.allowance ?? ALLOWANCE_8PCT_PESOS, 2), 2);
  const rate = input.rate ?? INCOME_TAX_RATE_8PCT;
  const threshold = input.threshold ?? NON_VAT_THRESHOLD_PESOS;
  const c = pesosMaxZeroDiff(a, b);
  const d = pesosTimesRate(c, rate);
  const e = fromScaled(toScaled(input.taxPaidEarlierQuarters || "0", 2), 2);
  const f = fromScaled(toScaled(input.creditableWithholding || "0", 2), 2);
  const g = pesosDiff(d, e, f);
  const overThreshold = toScaled(a, 2) > toScaled(threshold, 2);
  return { a, b, c, d, e, f, g, overThreshold, rate, allowanceLabel: ALLOWANCE_8PCT_LABEL };
}

/** True when either cumulative figure exceeds the non-VAT threshold. */
export function eitherOverThreshold(invoiced: string, collected: string, threshold = NON_VAT_THRESHOLD_PESOS): boolean {
  const lim = toScaled(threshold, 2);
  return toScaled(invoiced || "0", 2) > lim || toScaled(collected || "0", 2) > lim;
}
