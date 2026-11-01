// Deep links from Home tiles to pre-filtered list pages.

import { currentMonthPeriod } from "../books/period";
import { addDays, isoDate, manilaToday } from "../format";

export const HOME_QUOTE_NEEDS_APPROVAL = "needsApproval";
export const HOME_QUOTE_NO_REPLY = "noReply";
export const HOME_QUOTE_OPEN = "open";
export const HOME_SO_NEEDS_PO = "needsPo";
export const HOME_SO_OPEN = "open";
export const HOME_PO_BILLED_OVER = "billedOver";
export const HOME_BILLS_DUE_DAYS = "7";

/** Quotes list: DRAFT + SENT (not WON / LOST / VOID). */
export function openQuotesHref(): string {
  return `/quotes?${HOME_QUOTE_OPEN}=1`;
}

/** Sales orders list: OPEN with remaining-to-bill &gt; 0 (not VOID / fully billed). */
export function openSalesOrdersHref(): string {
  return `/sales-orders?${HOME_SO_OPEN}=1`;
}

export function quotesNeedsApprovalHref(): string {
  return `/quotes?${HOME_QUOTE_NEEDS_APPROVAL}=1`;
}

export function quotesNoReplyHref(): string {
  return `/quotes?status=SENT&${HOME_QUOTE_NO_REPLY}=7`;
}

export function salesOrdersNeedsPoHref(): string {
  return `/sales-orders?${HOME_SO_NEEDS_PO}=1`;
}

export function posAwaitingReceiptHref(): string {
  return "/receiving";
}

export function billsOverPoHref(): string {
  return `/purchase-orders?${HOME_PO_BILLED_OVER}=1`;
}

export function billingsOverdueHref(): string {
  return "/billing/billings?status=OVERDUE";
}

/** Customers whose withholding pick is still null (not set). */
export function customersNoWithholdingHref(): string {
  return "/customers?wh=NOT_SET";
}

/** Billings that still need a customer 2307 recorded. */
export function pending2307Href(): string {
  return "/billing/2307?status=PENDING";
}

export function owedByCustomersHref(): string {
  return "/billing/aging";
}

export function billingsOverdueMoneyHref(): string {
  return "/billing/billings?status=OVERDUE";
}

export function collectedThisMonthHref(now: Date = new Date()): string {
  const { fromYmd, toYmd } = currentMonthPeriod(now);
  return `/billing/collections?status=POSTED&from=${fromYmd}&to=${toYmd}`;
}

export function supplierBillsDueSoonHref(now: Date = new Date()): string {
  const today = isoDate(manilaToday(now));
  const until = isoDate(addDays(manilaToday(now), 7));
  return `/payables?dueFrom=${today}&dueTo=${until}`;
}

export function taxCalendarHref(): string {
  return "/books/tax/calendar";
}

export function nonVatHref(): string {
  return "/billing";
}

export function newCustomerHref(): string {
  return "/customers/new";
}

export function newQuoteHref(): string {
  return "/quotes/new";
}

export function newBillingHref(): string {
  return "/billing/billings/new";
}

export function auditLogHref(): string {
  return "/audit";
}
