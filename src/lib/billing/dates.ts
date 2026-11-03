// Due dates from SO payment terms, and Manila calendar-day math for aging /
// overdue. Pure (no DB) so unit tests cover the boundaries without MySQL.

import { addDays, formatDate, manilaToday } from "../format";

/** YYYY-MM-DD of a DATE column (stored as 00:00 UTC of that calendar day). */
export function dateYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (both DATE-style). Negative if to < from. */
export function calendarDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

/**
 * Expected payment date for a government deal billing:
 * IAR date + 30 calendar days. Staff can change the Expected by date.
 */
export function expectedPaymentDateFromIar(iarDate: Date): Date {
  return addDays(iarDate, 30);
}

/**
 * Label for government billings: "Expected by <date> (estimate)".
 */
export function formatExpectedPaymentLabel(date: Date): string {
  return `Expected by ${formatDate(date)} (estimate)`;
}

/**
 * Default due date from SO payment terms.
 * - COD / blank / unknown → invoice date
 * - "Net N" (optionally with a trailing note, e.g. "Net 30 (approved accounts only)")
 *   → invoice date + N days
 * - "50% down, 50% on delivery" (and similar 50/50) → invoice date
 *   (partial billings; due is editable)
 * - "100% upfront …" → invoice date
 */
export function dueDateFromTerms(invoiceDate: Date, terms: string | null | undefined): Date {
  const t = (terms ?? "").trim();
  if (!t) return invoiceDate;
  // Allow a note after the number so HACIEN's "Net 30 (approved accounts only)" still adds 30 days.
  const net = /^net\s+(\d+)\b/i.exec(t);
  if (net) return addDays(invoiceDate, Number(net[1]));
  if (/^cod$/i.test(t)) return invoiceDate;
  if (/50\s*%?\s*down/i.test(t) || /50\s*\/\s*50/i.test(t)) return invoiceDate;
  return invoiceDate;
}

/** Manila "today" as a DATE value (same helper as the rest of the app). */
export function billingToday(now: Date = new Date()): Date {
  return manilaToday(now);
}

/**
 * Days past due relative to Manila today. 0 = due today or not yet due.
 * Grace days extend the due date before it counts as overdue.
 * Government billings are never past due.
 */
export function daysPastDue(dueDate: Date, today: Date = billingToday(), graceDays = 0, isGovernment = false): number {
  if (isGovernment) return 0;
  const effective = graceDays > 0 ? addDays(dueDate, graceDays) : dueDate;
  const days = calendarDaysBetween(effective, today);
  return days > 0 ? days : 0;
}

/**
 * Government billings past Expected by must NEVER show as overdue.
 */
export function isOverdue(dueDate: Date, balance: string | number, today: Date = billingToday(), graceDays = 0, isGovernment = false): boolean {
  if (isGovernment) return false;
  const bal = typeof balance === "number" ? balance : Number(balance);
  return bal > 0 && daysPastDue(dueDate, today, graceDays, isGovernment) > 0;
}
