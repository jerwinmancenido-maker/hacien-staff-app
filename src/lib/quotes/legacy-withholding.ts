// Legacy docs (pre line-rate snapshot) keep a document-level withholding JSON
// and withholdingTotal while line rates are NULL. Saving must not recompute
// those to ₱0. Prefer backfilling rates from the stored JSON; if that still
// yields ₱0, refuse the save (never keep mismatched WH vs contract/supplier).

import { docTotals, type WithholdingSnapshot } from "./calc";
import type { PlannedItem } from "./items";

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

/** Plain staff message when a legacy save cannot reconstruct line rates. */
export const LEGACY_WITHHOLDING_REAPPLY_REQUIRED =
  "Re-apply this customer's withholding before saving.";

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

/**
 * Pick a rate/ATC for a line kind from the document withholding JSON.
 * Government docs: prefer GOV_PT over GOV_VAT when both are present (same
 * priority as migration 20261031140000 Pass 2).
 */
export function rateFromDocWithholding(
  withholding: unknown,
  kind: "GOODS" | "SERVICES",
): { withholdingRate: string; withholdingAtc: string | null } | null {
  const rows = asSnapshots(withholding);
  const byKind = rows.find((r) => r.lineKind === kind);
  if (byKind) return { withholdingRate: byKind.rate, withholdingAtc: byKind.atcCode };
  const govPt = rows.find((r) => r.lineKind === "GOV_PT");
  if (govPt) return { withholdingRate: govPt.rate, withholdingAtc: govPt.atcCode };
  const govVat = rows.find((r) => r.lineKind === "GOV_VAT");
  if (govVat) return { withholdingRate: govVat.rate, withholdingAtc: govVat.atcCode };
  return null;
}

/** Fill NULL line rates from the document snapshot (does not touch lines that already have a rate). */
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

export type PreserveLegacyOk = {
  ok: true;
  items: PlannedItem[];
  totals: PreservedTotals;
  withholding: WithholdingSnapshot[];
  /** True when null rates were backfilled from the doc JSON. */
  preserved: boolean;
};

export type PreserveLegacyErr = { ok: false; message: string };

export type PreserveLegacyResult = PreserveLegacyOk | PreserveLegacyErr;

function hasMissingLineRate(items: PlannedItem[]): boolean {
  return items.some((i) => i.withholdingRate == null || i.withholdingRate === "");
}

function passThrough(items: PlannedItem[], totals: ReturnType<typeof docTotals>, preserved: boolean): PreserveLegacyOk {
  return {
    ok: true,
    items,
    totals: {
      contractPrice: totals.contractPrice,
      withholdingTotal: totals.withholdingTotal,
      netReceived: totals.netReceived,
      supplierCost: totals.supplierCost,
      netMargin: totals.netMargin,
      netMarginPct: totals.netMarginPct,
    },
    withholding: totals.withholding.map(({ code, label, lineKind, rate, atcCode }) => ({
      code,
      label,
      lineKind,
      rate,
      atcCode,
    })),
    preserved,
  };
}

/**
 * After planItems: if the doc has stored WH ≠ 0 but planned lines would total
 * WH 0 *and* some rates are still missing/NULL (true legacy rows), backfill from
 * the doc JSON. Explicit 0 / 0.0000 (or Re-apply → NONE) must save ₱0 — do not
 * treat those as legacy. If the JSON cannot supply rates, fail closed.
 */
export function preserveLegacyWithholdingOnSave(before: DocMoney, items: PlannedItem[]): PreserveLegacyResult {
  const storedWh = Number(money(before.withholdingTotal));
  const first = docTotals(items);
  if (!(storedWh !== 0 && Number(first.withholdingTotal) === 0 && hasMissingLineRate(items))) {
    return passThrough(items, first, false);
  }

  const filled = fillNullLineRatesFromDocWithholding(items, before.withholding);
  const second = docTotals(filled);
  if (Number(second.withholdingTotal) !== 0) {
    return passThrough(filled, second, true);
  }

  // Still zero after backfill — JSON could not reconstruct rates. Refuse rather
  // than keep old WH money against the edited contract/supplier totals.
  return { ok: false, message: LEGACY_WITHHOLDING_REAPPLY_REQUIRED };
}
