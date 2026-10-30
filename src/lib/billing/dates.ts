// Due dates from SO payment terms, and Manila calendar-day math for aging /
// overdue. Pure (no DB) so unit tests cover the boundaries without MySQL.

import { addDays, manilaToday } from "../format";

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
 * Default due date from SO payment terms.
 * - COD / blank / unknown → invoice date
 * - "Net N" → invoice date + N days
 * - "50% down, 50% on delivery" (and similar 50/50) → invoice date
 *   (partial billings; due is editable)
 */
export function dueDateFromTerms(invoiceDate: Date, terms: string | null | undefined): Date {
  const t = (terms ?? "").trim();
  if (!t) return invoiceDate;
  const net = /^net\s+(\d+)$/i.exec(t);
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
 */
export function daysPastDue(dueDate: Date, today: Date = billingToday(), graceDays = 0): number {
  const effective = graceDays > 0 ? addDays(dueDate, graceDays) : dueDate;
  const days = calendarDaysBetween(effective, today);
  return days > 0 ? days : 0;
}

export function isOverdue(dueDate: Date, balance: string | number, today: Date = billingToday(), graceDays = 0): boolean {
  const bal = typeof balance === "number" ? balance : Number(balance);
  return bal > 0 && daysPastDue(dueDate, today, graceDays) > 0;
}
