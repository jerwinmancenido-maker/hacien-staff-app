// Collection deductions (ERP payment-entry model, 2026-11-28): pure
// helpers shared by the collection service and the collection form.
// A deduction is an amount the payer kept out of a collection:
//   - Withholding (2307) — settlement-only; it lives on the allocations
//     and the Withholding2307 records, never in these rows, and never
//     touches the cash account.
//   - FEE — the channel's charge; cash-affecting, posts a linked
//     expense (the PR #354 collection fee, generalised).
//   - OTHER — any other kept amount, with a staff-typed label; the row
//     declares whether it is cash-affecting (posts a linked expense,
//     reduces what lands in the account) or settlement-only (settles
//     the billing, no account movement, no expense).
// Settlement proof: Applied = cash + deductions, where Applied is what
// the billings settle by (cash applied + withholding applied), cash is
// what actually lands toward them, and deductions = withholding + every
// row below. Neither cash nor the account movement may go negative.

import { fromScaled, toScaled } from "../quotes/calc";

export type DeductionKind = "FEE" | "OTHER";

export type DeductionRowInput = {
  kind: DeductionKind;
  label?: string | null;
  amount: string;
  /** OTHER rows only; FEE is always cash-affecting. Default true. */
  cashAffecting?: boolean;
};

export type NormalisedDeduction = {
  kind: DeductionKind;
  label: string | null;
  amount: string;
  cashAffecting: boolean;
};

/** Normalise a money string to 2dp ("0" → "0.00"). */
export function money2(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "0.00";
  return fromScaled(toScaled(String(v), 2), 2);
}

function scaled(v: string): bigint {
  return toScaled(money2(v), 2);
}

/**
 * The expense-posting deduction rows for a collection: the posted rows,
 * plus the legacy scalar feeAmount (PR #354) folded in as one FEE row
 * when it is above zero, so old callers keep exactly their behaviour.
 */
export function normaliseDeductions(input: {
  feeAmount?: string | null;
  deductions?: readonly DeductionRowInput[] | null;
}): NormalisedDeduction[] {
  const rows: NormalisedDeduction[] = (input.deductions ?? []).map((r) => ({
    kind: r.kind,
    label: r.kind === "OTHER" ? (r.label?.trim() ? r.label.trim() : null) : null,
    amount: money2(r.amount),
    cashAffecting: r.kind === "FEE" ? true : (r.cashAffecting ?? true),
  }));
  const legacyFee = money2(input.feeAmount ?? "0");
  if (toScaled(legacyFee, 2) > 0n) {
    rows.unshift({ kind: "FEE", label: null, amount: legacyFee, cashAffecting: true });
  }
  return rows;
}

/** Sum of the expense-posting rows (FEE + OTHER). Withholding excluded. */
export function deductionRowsTotal(rows: readonly NormalisedDeduction[]): string {
  return fromScaled(
    rows.reduce((a, r) => a + scaled(r.amount), 0n),
    2,
  );
}

/** Sum of the FEE rows only — mirrored into Collection.feeAmount. */
export function feeRowsTotal(rows: readonly NormalisedDeduction[]): string {
  return fromScaled(
    rows.filter((r) => r.kind === "FEE").reduce((a, r) => a + scaled(r.amount), 0n),
    2,
  );
}

/**
 * Bounds for the deduction rows, or null when acceptable. Mirrors the
 * settlement proof: deductions (withholding + rows) may not exceed the
 * amount applied to the billings, and the rows may not exceed the
 * amount received — either way the cash left over would go negative.
 * The applied check is skipped when nothing is applied (a deposit or
 * credit collection: the amount-received bound alone governs, exactly
 * as the PR #354 fee behaved).
 */
export function deductionsError(
  rows: readonly NormalisedDeduction[],
  args: { amountReceived: string; applied: string; withholding: string },
): string | null {
  for (const r of rows) {
    if (scaled(r.amount) <= 0n) {
      return "Each deduction needs an amount above ₱0.00 — remove the row if it does not apply.";
    }
    if (r.kind === "OTHER" && !r.label) {
      return "Give each 'Other' deduction a label — it is written on the record it posts.";
    }
  }
  const rowsTotal = deductionRowsTotal(rows);
  if (scaled(rowsTotal) > scaled(args.amountReceived)) {
    if (rows.length === 1 && rows[0]!.kind === "FEE") {
      return `Collection fee can't be more than the amount received (₱${money2(args.amountReceived)}). Lower the fee.`;
    }
    return `Deductions can't be more than the amount received (₱${money2(args.amountReceived)}). Lower the deductions.`;
  }
  const applied = scaled(args.applied);
  if (applied > 0n) {
    const deductions = scaled(args.withholding) + scaled(rowsTotal);
    if (deductions > applied) {
      return `Deductions (₱${fromScaled(deductions, 2)}) can't be more than the amount applied to the billings (₱${money2(args.applied)}) — the cash left over would go below zero.`;
    }
  }
  return null;
}

/**
 * Notes fingerprint for a deduction's expense — the FEE wording is the
 * PR #354 fingerprint verbatim, so fee expenses read the same before
 * and after this generalisation.
 */
export function deductionExpenseNotes(
  row: Pick<NormalisedDeduction, "kind" | "label">,
  collectionNumber: string,
  billingNumbers: readonly string[],
): string {
  const head =
    row.kind === "FEE"
      ? `Collection fee withheld from collection - collection ${collectionNumber}`
      : `Collection deduction (${row.label ?? "Other"}) withheld from collection - collection ${collectionNumber}`;
  if (!billingNumbers.length) return `${head}.`;
  return `${head}, billing ${billingNumbers.join(", ")}.`;
}

/** The live settlement proof: Applied = cash + deductions. */
export function settlementProof(args: {
  cashApplied: string;
  withholdingApplied: string;
  rows: readonly NormalisedDeduction[];
}): { applied: string; cash: string; deductions: string; withholding: string } {
  const applied = scaled(args.cashApplied) + scaled(args.withholdingApplied);
  const deductions = scaled(args.withholdingApplied) + scaled(deductionRowsTotal(args.rows));
  return {
    applied: fromScaled(applied, 2),
    cash: fromScaled(applied - deductions, 2),
    deductions: fromScaled(deductions, 2),
    withholding: money2(args.withholdingApplied),
  };
}
