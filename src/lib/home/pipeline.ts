// Home Pipeline card: open quotes + open (unbilled) sales orders.
// Customer docs only — no cost / supplier fields.

import type { QuoteStatus, SalesOrderStatus } from "@prisma/client";
import { remainingToBill } from "../billing/status";
import { formatPesoWhole } from "../format";
import { can, type PermissionUser } from "../permissions";
import { toScaled } from "../quotes/calc";
import { openQuotesHref, openSalesOrdersHref } from "./hrefs";

/** Open quotes = not yet converted / declined / void. App has no EXPIRED status. */
export const OPEN_QUOTE_STATUSES: readonly QuoteStatus[] = ["DRAFT", "SENT"];

/**
 * Excluded from open-quotes:
 * - WON = converted to an SO
 * - LOST = declined
 * - VOID = void
 * (No EXPIRED status exists; validUntil is display-only.)
 */
export const EXCLUDED_OPEN_QUOTE_STATUSES: readonly QuoteStatus[] = ["WON", "LOST", "VOID"];

export function isOpenQuoteStatus(status: QuoteStatus): boolean {
  return (OPEN_QUOTE_STATUSES as readonly string[]).includes(status);
}

/** Cancelled SOs use VOID. Fully billed = remaining-to-bill ≤ 0 while still OPEN. */
export function isOpenUnbilledSalesOrder(
  status: SalesOrderStatus,
  contractPrice: string,
  nonVoidBillingAmounts: readonly string[],
): boolean {
  if (status !== "OPEN") return false;
  const remaining = remainingToBill(contractPrice, nonVoidBillingAmounts);
  return toScaled(remaining, 2) > 0n;
}

export function soUnbilledAmount(
  contractPrice: string,
  nonVoidBillingAmounts: readonly string[],
): string {
  const remaining = remainingToBill(contractPrice, nonVoidBillingAmounts);
  // Never show a negative unbilled remainder on the Pipeline card.
  return toScaled(remaining, 2) > 0n ? remaining : "0.00";
}

/** Row caption: "3 open · ₱450,000" (whole pesos). */
export function pipelineOpenCaption(count: number, amount: string | number): string {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return `${n} open · ${formatPesoWhole(amount)}`;
}

/** Quotes + SOs lists both require `view` (same as their list pages). */
export function canSeeHomePipelineQuotes(user: PermissionUser): boolean {
  return can(user, "view");
}

export function canSeeHomePipelineSalesOrders(user: PermissionUser): boolean {
  return can(user, "view");
}

export type HomePipelineRow = {
  label: string;
  caption: string;
  count: number;
  amount: string;
  href: string;
};

export type HomePipeline = {
  quotes: HomePipelineRow | null;
  salesOrders: HomePipelineRow | null;
};

export function buildHomePipeline(opts: {
  user: PermissionUser;
  quotesCount: number;
  quotesTotal: string;
  salesOrdersCount: number;
  salesOrdersUnbilled: string;
}): HomePipeline | null {
  const quotes = canSeeHomePipelineQuotes(opts.user)
    ? {
        label: "Open quotes",
        count: opts.quotesCount,
        amount: opts.quotesTotal,
        caption: pipelineOpenCaption(opts.quotesCount, opts.quotesTotal),
        href: openQuotesHref(),
      }
    : null;
  const salesOrders = canSeeHomePipelineSalesOrders(opts.user)
    ? {
        label: "Open sales orders",
        count: opts.salesOrdersCount,
        amount: opts.salesOrdersUnbilled,
        caption: pipelineOpenCaption(opts.salesOrdersCount, opts.salesOrdersUnbilled),
        href: openSalesOrdersHref(),
      }
    : null;
  if (!quotes && !salesOrders) return null;
  return { quotes, salesOrders };
}
