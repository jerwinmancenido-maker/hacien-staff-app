// Legacy docs (pre line-rate snapshot) keep a document-level withholding JSON
// and withholdingTotal while line rates are NULL. Saving must not recompute
// those to ₱0. Prefer backfilling rates from the stored JSON; if that still
// yields ₱0, keep the stored WH money fields.

import { docTotals, fromScaled, toScaled, type WithholdingSnapshot } from "./calc";
import type { PlannedItem } from "./items";

/** Half-up division matching calc.ts docTotals margin %. */
function divRound(num: bigint, den: bigint): bigint {
  if (den === 0n) return 0n;
  const negative = num < 0n !== den < 0n;
  const a = num < 0n ? -num : num;
  const b = den < 0n ? -den : den;
  const q = (a * 2n + b) / (b * 2n);
  return negative ? -q : q;
}

type DocMoney = {
  contractPrice: { toString(): string } | string | number;
  withholdingTotal: { toString(): string } | string | number;
  netReceived: { toString(): string } | string | number;
  supplierCost: { toString(): string } | string | number;
  netMargin: { toString(): string } | string | number;
  netMarginPct: { toString(): string } | string | number;
  withholding: unknown;
};

function money(v: { toString(): string } | string | number): string {
  return Number(v.toString()).toFixed(2);
}

function asSnapshots(raw: unknown): WithholdingSnapshot[] {
  if (!Array.isArray(raw)) return [];
  const out: WithholdingSnapshot[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const rate = r.rate != null ? Number(r.rate).toFixed(4) : null;
    const lineKind = typeof r.lineKind === "string" ? r.lineKind : null;
    if (!rate || !lineKind) continue;
    out.push({
      code: typeof r.code === "string" ? r.code : lineKind,
      label: typeof r.label === "string" ? r.label : lineKind,
      lineKind: lineKind as WithholdingSnapshot["lineKind"],
      rate,
      atcCode: typeof r.atcCode === "string" && r.atcCode ? r.atcCode : null,
    });
  }
  return out;
}

/** Pick a rate/ATC for a line kind from the document withholding JSON. */
export function rateFromDocWithholding(
  withholding: unknown,
  kind: "GOODS" | "SERVICES",
): { withholdingRate: string; withholdingAtc: string | null } | null {
  const rows = asSnapshots(withholding);
  const byKind = rows.find((r) => r.lineKind === kind);
  if (byKind) return { withholdingRate: byKind.rate, withholdingAtc: byKind.atcCode };
  const gov = rows.find((r) => r.lineKind === "GOV_PT" || r.lineKind === "GOV_VAT");
  if (gov) return { withholdingRate: gov.rate, withholdingAtc: gov.atcCode };
  return null;
}

/** Fill NULL line rates from the document snapshot (does not touch override lines with a rate). */
export function fillNullLineRatesFromDocWithholding(items: PlannedItem[], withholding: unknown): PlannedItem[] {
  return items.map((item) => {
    if (item.withholdingRate != null && item.withholdingRate !== "") return item;
    const found = rateFromDocWithholding(withholding, item.kind);
    if (!found) return item;
    return {
      ...item,
      withholdingRate: found.withholdingRate,
      withholdingAtc: item.withholdingAtc ?? found.withholdingAtc,
      withholdingOverride: false,
    };
  });
}

export type PreservedTotals = {
  contractPrice: string;
  withholdingTotal: string;
  netReceived: string;
  supplierCost: string;
  netMargin: string;
  netMarginPct: string;
};

export type PreserveLegacyResult = {
  items: PlannedItem[];
  totals: PreservedTotals;
  withholding: WithholdingSnapshot[];
  /** True when stored WH was kept because null rates would have wiped it. */
  preserved: boolean;
};

/**
 * After planItems: if the doc has stored WH ≠ 0 but planned lines would total
 * WH 0 (typical legacy NULL rates), backfill from the doc JSON; if still 0,
 * keep the stored WH amount (and recompute net from the new contract price).
 */
export function preserveLegacyWithholdingOnSave(before: DocMoney, items: PlannedItem[]): PreserveLegacyResult {
  const storedWh = Number(money(before.withholdingTotal));
  const first = docTotals(items);
  if (!(storedWh !== 0 && Number(first.withholdingTotal) === 0)) {
    return {
      items,
      totals: {
        contractPrice: first.contractPrice,
        withholdingTotal: first.withholdingTotal,
        netReceived: first.netReceived,
        supplierCost: first.supplierCost,
        netMargin: first.netMargin,
        netMarginPct: first.netMarginPct,
      },
      withholding: first.withholding.map(({ code, label, lineKind, rate, atcCode }) => ({
        code,
        label,
        lineKind,
        rate,
        atcCode,
      })),
      preserved: false,
    };
  }

  const filled = fillNullLineRatesFromDocWithholding(items, before.withholding);
  const second = docTotals(filled);
  if (Number(second.withholdingTotal) !== 0) {
    return {
      items: filled,
      totals: {
        contractPrice: second.contractPrice,
        withholdingTotal: second.withholdingTotal,
        netReceived: second.netReceived,
        supplierCost: second.supplierCost,
        netMargin: second.netMargin,
        netMarginPct: second.netMarginPct,
      },
      withholding: second.withholding.map(({ code, label, lineKind, rate, atcCode }) => ({
        code,
        label,
        lineKind,
        rate,
        atcCode,
      })),
      preserved: true,
    };
  }

  // Still zero — keep stored WH money; contract/supplier follow the edited lines.
  const contract = first.contractPrice;
  const supplier = first.supplierCost;
  const withholdingTotal = money(before.withholdingTotal);
  const netReceived = fromScaled(toScaled(contract, 2) - toScaled(withholdingTotal, 2), 2);
  const netMargin = fromScaled(toScaled(netReceived, 2) - toScaled(supplier, 2), 2);
  const contractCents = toScaled(contract, 2);
  const pct = contractCents === 0n ? "0.00" : fromScaled(divRound(toScaled(netMargin, 2) * 10_000n, contractCents), 2);
  const snapshots = asSnapshots(before.withholding);
  return {
    items: filled,
    totals: {
      contractPrice: contract,
      withholdingTotal,
      netReceived,
      supplierCost: supplier,
      netMargin,
      netMarginPct: pct,
    },
    withholding: snapshots,
    preserved: true,
  };
}
