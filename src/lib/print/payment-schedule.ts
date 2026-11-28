// Printed payment-schedule table for billing statements (ERP adoption
// item 14). When the sales order's payment terms resolve to one of the
// three schedulable kinds — COD, 50/50, Net 30 — the billing statement
// prints a small table under the terms showing how the billing's Total
// is paid and when. Any other terms (100% upfront, custom text, none)
// print NO table: those prints stay byte-identical to before this item.
//
// The classification is resolvePaymentTerm's — the same structured term
// that drives Point 2 of the quote/SO terms block and the printed
// Remarks row — so the schedule can never disagree with the terms the
// document already prints. Keyed on the stored texts the item-10
// presets fill in ("COD", "50% down, 50% on delivery",
// "Net 30 (approved accounts only)").
//
// Amounts are the billing's gross Total only: withholding is office
// math and never appears on a customer print. Money math runs in
// scaled centavos (BigInt); the 50/50 split rounds the first row
// half-up and the LAST row carries the remainder, so the rows always
// sum exactly to the Total, to the centavo.

import { formatDate } from "@/lib/format";
import { divRound, fromScaled, toScaled } from "@/lib/quotes/calc";
import { resolvePaymentTerm } from "./terms-block";
import type { PrintPaymentScheduleRow } from "./types";

const CENTS = 2;

export function buildPaymentSchedule(opts: {
  /** The sales order's stored payment-terms text. */
  paymentTerms?: string | null;
  /** The billing's gross Total as a 2-decimal money string. */
  total: string;
  /** The billing's invoice date as yyyy-mm-dd (ymd), for Net 30. */
  invoiceDateYmd: string | null;
}): PrintPaymentScheduleRow[] | null {
  const kind = resolvePaymentTerm(opts.paymentTerms).kind;
  if (kind !== "COD" && kind !== "FIFTY_FIFTY" && kind !== "NET30") return null;
  const totalCents = toScaled(opts.total, CENTS);
  const total = fromScaled(totalCents, CENTS);
  switch (kind) {
    case "COD":
      return [{ label: "100% — Cash on Delivery", due: "On delivery", amount: total }];
    case "FIFTY_FIFTY": {
      const first = divRound(totalCents, 2n);
      return [
        { label: "50% — down payment", due: "On order confirmation", amount: fromScaled(first, CENTS) },
        { label: "50% — balance", due: "On delivery", amount: fromScaled(totalCents - first, CENTS) },
      ];
    }
    case "NET30": {
      // The one kind with a derivable calendar date: invoice date + 30
      // days, rendered with the print's own date convention (views.ts
      // day(): the yyyy-mm-dd read as UTC midnight, formatted in
      // Manila). Without an invoice date there is nothing truthful to
      // print, so no table.
      if (!opts.invoiceDateYmd) return null;
      const due = new Date(`${opts.invoiceDateYmd}T00:00:00.000Z`);
      due.setUTCDate(due.getUTCDate() + 30);
      return [{ label: "100%", due: formatDate(due), amount: total }];
    }
  }
}
