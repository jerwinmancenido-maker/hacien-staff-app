// Cost & margin for a sales order: pure scaled-decimal math (no floats).
// Used by the Cost & margin tab — which PO cost basis to use, actual vs planned
// margin, and the two plain-language warnings.
//
// Planned (before withholding) = contract − planned supplier cost.
// After customer withholding = (contract − stored withholdingTotal) − cost,
// where withholdingTotal is the per-line sum saved on the SO (drafts only
// recalculate; issued/void keep stored money).

import { fromScaled, toScaled } from "../quotes/calc";

const CENTS = 2;

/** Divide and round half away from zero (same as quotes/calc). */
function divRound(num: bigint, den: bigint): bigint {
  if (den === 0n) return 0n;
  const negative = num < 0n !== den < 0n;
  const a = num < 0n ? -num : num;
  const b = den < 0n ? -den : den;
  return negative ? -((a * 2n + b) / (b * 2n)) : (a * 2n + b) / (b * 2n);
}

/** qty (2 dp) × unit cost (2 dp) → cents, half away from zero. */
export function valueReceivedCents(
  items: readonly { qtyReceived: string; unitCost: string }[],
): bigint {
  let cents = 0n;
  for (const i of items) {
    const p = toScaled(i.qtyReceived, CENTS) * toScaled(i.unitCost, CENTS);
    const neg = p < 0n;
    const a = neg ? -p : p;
    const r = (a + 50n) / 100n;
    cents += neg ? -r : r;
  }
  return cents;
}

export function valueReceived(items: readonly { qtyReceived: string; unitCost: string }[]): string {
  return fromScaled(valueReceivedCents(items), CENTS);
}

export function sumMoney(values: readonly string[]): string {
  return fromScaled(
    values.reduce((acc, v) => acc + toScaled(v, CENTS), 0n),
    CENTS,
  );
}

export type CostBasis = "BILLED" | "RECEIVED" | "PO_TOTAL";

export const COST_BASIS_LABELS: Record<CostBasis, string> = {
  BILLED: "Billed",
  RECEIVED: "Received",
  PO_TOTAL: "PO total",
};

/**
 * Prefer billed (when any non-void bill exists with a non-zero amount), else
 * received (when any posted RR exists), else the PO total. A recorded bill of
 * ₱0.00 falls back to the PO total — zero billed is not a useful cost.
 */
export function chooseCostBasis(input: {
  poTotal: string;
  receivedValue: string;
  billedAmount: string;
  hasBills: boolean;
  hasReceipts: boolean;
}): { basis: CostBasis; cost: string; basisLabel: string } {
  if (input.hasBills) {
    // ₱0.00 billed is not a useful cost — fall back to the PO total.
    if (toScaled(input.billedAmount, CENTS) === 0n) {
      return { basis: "PO_TOTAL", cost: input.poTotal, basisLabel: COST_BASIS_LABELS.PO_TOTAL };
    }
    return { basis: "BILLED", cost: input.billedAmount, basisLabel: COST_BASIS_LABELS.BILLED };
  }
  if (input.hasReceipts) {
    return { basis: "RECEIVED", cost: input.receivedValue, basisLabel: COST_BASIS_LABELS.RECEIVED };
  }
  return { basis: "PO_TOTAL", cost: input.poTotal, basisLabel: COST_BASIS_LABELS.PO_TOTAL };
}

/** Contract − cost; % of contract (2 dp). Same basis for Planned and Actual. */
export function actualMargin(
  contractPrice: string,
  totalCost: string,
): { margin: string; marginPct: string } {
  const contract = toScaled(contractPrice, CENTS);
  const cost = toScaled(totalCost, CENTS);
  const margin = contract - cost;
  return { margin: fromScaled(margin, CENTS), marginPct: marginPercent(fromScaled(margin, CENTS), contractPrice) };
}

/** Margin amount as a percent of the contract price (2 dp), half away from zero. */
export function marginPercent(marginAmount: string, contractPrice: string): string {
  const contract = toScaled(contractPrice, CENTS);
  if (contract === 0n) return "0.00";
  return fromScaled(divRound(toScaled(marginAmount, CENTS) * 10_000n, contract), 2);
}

export type CostState = "none" | "partial" | "full";

/** Non-zero supplier bill, or a posted receipt. A PO total alone is not incurred cost. */
export function incurredAmount(input: {
  poTotal: string;
  receivedValue: string;
  billedAmount: string;
  hasBills: boolean;
  hasReceipts: boolean;
}): string | null {
  if (input.hasBills && toScaled(input.billedAmount, CENTS) !== 0n) return input.billedAmount;
  if (input.hasReceipts) return input.receivedValue;
  return null;
}

/** True when ordered qty on non-void POs is still short of the SO line qty. */
export function lineNeedsMorePo(soQty: string, orderedQty: string): boolean {
  return toScaled(orderedQty, CENTS) < toScaled(soQty, CENTS);
}

/** True when non-void billed amount exceeds the PO total. */
export function billExceedsPo(poTotal: string, billedAmount: string): boolean {
  return toScaled(billedAmount, CENTS) > toScaled(poTotal, CENTS);
}

export type CostMarginPoInput = {
  id: string;
  number: string;
  status: string;
  supplierName: string;
  poTotal: string;
  receivedValue: string;
  billedAmount: string;
  hasBills: boolean;
  hasReceipts: boolean;
};

export type CostMarginPoRow = CostMarginPoInput & {
  basis: CostBasis;
  basisLabel: string;
  cost: string;
  billedOverPo: boolean;
};

export type CostMarginWarning = {
  code: "LINES_WITHOUT_PO" | "BILLED_OVER_PO";
  title: string;
  hint: string;
  /** Direct link (e.g. PO Match tab) when the warning points at a specific record. */
  href?: string;
};

export type CostMarginSummary = {
  rows: CostMarginPoRow[];
  totalCost: string;
  contractPrice: string;
  /** Stored SO withholding total (per-line sum when last saved as a draft). */
  withholdingTotal: string;
  /** Sum of incurred costs (billed or received). PO totals are not included. */
  incurredCost: string;
  /** Quote / SO planned supplier cost. */
  plannedCost: string;
  costState: CostState;
  /** "Margin so far" while incurred cost is partial; otherwise "Actual margin". */
  marginLabel: string;
  actual: { margin: string; marginPct: string };
  planned: { margin: string; marginPct: string };
  /**
   * Peso is net received − incurred cost.
   * Percent is that peso divided by the contract price (not by net received).
   */
  afterWithholding: { margin: string; marginPct: string; netReceived: string };
  warnings: CostMarginWarning[];
};

export function buildCostMarginSummary(input: {
  contractPrice: string;
  /** Planned supplier cost from the SO / quote (before withholding). */
  plannedCost: string;
  /** Stored withholding total from the SO (per-line sum; never silently recomputed here). */
  withholdingTotal?: string;
  pos: readonly CostMarginPoInput[];
  /** SO lines still short of PO coverage (ordered < SO qty). */
  uncoveredLineCount: number;
}): CostMarginSummary {
  const rows: CostMarginPoRow[] = input.pos.map((p) => {
    const chosen = chooseCostBasis(p);
    return {
      ...p,
      ...chosen,
      billedOverPo: billExceedsPo(p.poTotal, p.billedAmount),
    };
  });
  const totalCost = sumMoney(rows.map((r) => r.cost));
  const incurredParts = input.pos.map((p) => incurredAmount(p)).filter((v): v is string => v != null);
  const incurredCost = sumMoney(incurredParts);
  const incurredCount = incurredParts.length;
  const costState: CostState =
    incurredCount === 0
      ? "none"
      : input.pos.length > 0 && incurredCount === input.pos.length && input.uncoveredLineCount === 0
        ? "full"
        : "partial";
  const marginLabel = costState === "partial" ? "Margin so far" : "Actual margin";
  const withholdingTotal = input.withholdingTotal ?? "0.00";
  const netReceived = fromScaled(toScaled(input.contractPrice, CENTS) - toScaled(withholdingTotal, CENTS), CENTS);
  // Before withholding: contract − incurred cost. Percent of the contract.
  const actual = actualMargin(input.contractPrice, incurredCost);
  const planned = actualMargin(input.contractPrice, input.plannedCost);
  // After customer withholding: peso is net received − incurred cost; percent is of the contract.
  const afterPeso = actualMargin(netReceived, incurredCost);
  const afterWithholding = {
    margin: afterPeso.margin,
    marginPct: marginPercent(afterPeso.margin, input.contractPrice),
    netReceived,
  };
  const warnings: CostMarginWarning[] = [];
  if (input.uncoveredLineCount > 0) {
    warnings.push({
      code: "LINES_WITHOUT_PO",
      title: "Some lines have no supplier PO yet",
      hint: "One or more sales-order lines still need a supplier PO for their full quantity. Open Create POs to cover them.",
    });
  }
  const overPo = rows.find((r) => r.billedOverPo);
  if (overPo) {
    warnings.push({
      code: "BILLED_OVER_PO",
      title: "Supplier billed more than the PO",
      hint: "At least one supplier bill total is higher than its purchase-order total. Check the PO’s Match tab before paying the difference.",
      href: `/purchase-orders/${overPo.id}?tab=match`,
    });
  }
  return {
    rows,
    totalCost,
    incurredCost,
    plannedCost: input.plannedCost,
    costState,
    marginLabel,
    contractPrice: input.contractPrice,
    withholdingTotal,
    actual,
    planned,
    afterWithholding,
    warnings,
  };
}
