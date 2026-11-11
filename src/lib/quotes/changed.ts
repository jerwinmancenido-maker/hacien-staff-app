// "Changed vs quote" markers (Part A of the SO+PO editability plan, approved
// by Jerwin with markers on all 4 document pairs). Pure comparison between a
// sales-order line and the quote line it was copied from (SalesOrderItem
// .quoteItemId, stamped at conversion; NULL on older SOs = no marker).
//
// Compared: quantity, unit price, kind, withholding rate + ATC. Description,
// unit label, supplier and unit cost are NOT marker fields (they are the
// always-editable / internal side). Rate comparison is scale-4, money
// scale-2 — the same scales the SO price lock uses.

import { toScaled } from "./calc";
import { formatPeso } from "../format";

export type QuoteLineSnapshot = {
  qty: string;
  unitPrice: string;
  kind: string;
  withholdingRate: string | null;
  withholdingAtc: string | null;
};

export type SoLineSnapshot = QuoteLineSnapshot;

/** One human-readable difference, e.g. "qty 10 → 12". */
export type LineChange = { field: "qty" | "price" | "kind" | "withholding"; label: string };

function rateEq(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return toScaled(a, 4) === toScaled(b, 4);
}

export function lineChangesVsQuote(so: SoLineSnapshot, quote: QuoteLineSnapshot): LineChange[] {
  const changes: LineChange[] = [];
  if (toScaled(so.qty, 2) !== toScaled(quote.qty, 2)) {
    changes.push({ field: "qty", label: `qty ${quote.qty} → ${so.qty}` });
  }
  if (toScaled(so.unitPrice, 2) !== toScaled(quote.unitPrice, 2)) {
    changes.push({ field: "price", label: `price ${formatPeso(quote.unitPrice)} → ${formatPeso(so.unitPrice)}` });
  }
  if (so.kind !== quote.kind) {
    changes.push({ field: "kind", label: `kind ${quote.kind} → ${so.kind}` });
  }
  if (!rateEq(so.withholdingRate, quote.withholdingRate) || (so.withholdingAtc ?? null) !== (quote.withholdingAtc ?? null)) {
    const fmt = (r: string | null, atc: string | null) => (r === null ? "no withholding" : `${(Number(r) * 100).toFixed(2).replace(/\.?0+$/, "")}%${atc ? ` ${atc}` : ""}`);
    changes.push({ field: "withholding", label: `withholding ${fmt(quote.withholdingRate, quote.withholdingAtc)} → ${fmt(so.withholdingRate, so.withholdingAtc)}` });
  }
  return changes;
}

/** "Quote: 10 pcs @ ₱1,200.00, now 12 pcs @ ₱1,150.00" — the tap/hover text. */
export function changedSummary(so: SoLineSnapshot & { unit: string }, quote: QuoteLineSnapshot & { unit: string }): string {
  return `Quote: ${quote.qty} ${quote.unit} @ ${formatPeso(quote.unitPrice)}, now ${so.qty} ${so.unit} @ ${formatPeso(so.unitPrice)}`;
}
