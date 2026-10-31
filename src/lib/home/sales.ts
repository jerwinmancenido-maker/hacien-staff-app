// Pure helpers for the Home Sales section (month windows, change %, axis
// labels, top customers). No DB — unit-tested. Gross sales definition matches
// the Non-VAT meter: non-voided Part 5 billings by invoiceDate (see
// src/lib/services/non-vat.ts). The app has no credit-note documents; customer
// credit from unapplied collections does not reduce sales.

import { formatCompactPesoLimit } from "./nonVatCopy";
import { isoDate, manilaToday } from "../format";
import { fromScaled, toScaled } from "../quotes/calc";
import { can, type PermissionUser } from "../permissions";

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Admin / Approver (`manage_billing`) — Staff and Viewer do not see Sales. */
export function canShowHomeSales(user: PermissionUser): boolean {
  return can(user, "manage_billing");
}

export type MonthKey = string; // YYYY-MM

/** Manila calendar YYYY-MM for `now`. */
export function manilaMonthKey(now: Date = new Date()): MonthKey {
  return isoDate(manilaToday(now)).slice(0, 7);
}

/** Shift a YYYY-MM key by `delta` months (negative = earlier). */
export function shiftMonthKey(key: MonthKey, delta: number): MonthKey {
  const [ys, ms] = key.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const idx = y * 12 + (m - 1) + delta;
  const yy = Math.floor(idx / 12);
  const mm = (idx % 12) + 1;
  return `${yy}-${String(mm).padStart(2, "0")}`;
}

/** Last `n` Manila calendar months ending at the month containing `now` (inclusive). */
export function lastNMonthKeys(now: Date, n: number): MonthKey[] {
  const end = manilaMonthKey(now);
  const keys: MonthKey[] = [];
  for (let i = n - 1; i >= 0; i--) keys.push(shiftMonthKey(end, -i));
  return keys;
}

export function monthKeyBounds(key: MonthKey): { fromYmd: string; toYmd: string } {
  const [ys, ms] = key.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const fromYmd = `${key}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const toYmd = `${key}-${String(lastDay).padStart(2, "0")}`;
  return { fromYmd, toYmd };
}

/** Short month label; include the year when the year changes vs the previous bar. */
export function salesMonthLabel(key: MonthKey, prevKey: MonthKey | null): { short: string; showYear: boolean; year: number } {
  const [ys, ms] = key.split("-");
  const year = Number(ys);
  const month = Number(ms);
  const short = SHORT_MONTHS[month - 1] ?? key;
  const prevYear = prevKey ? Number(prevKey.slice(0, 4)) : null;
  return { short, showYear: prevYear !== null && prevYear !== year, year };
}

/**
 * Change vs last month for the Sales row (plain wording, no colour / arrows).
 * - last month is 0 or missing → "—"
 * - equal → "Same"
 * - otherwise "Up N%" / "Down N%" (integer %, floored toward zero)
 */
export function salesChangeVsLastMonth(
  thisMonth: number | string,
  lastMonth: number | string,
): { label: string; tone: "up" | "down" | "flat" | "none" } {
  const cur = typeof thisMonth === "number" ? thisMonth : Number(thisMonth);
  const prev = typeof lastMonth === "number" ? lastMonth : Number(lastMonth);
  if (!Number.isFinite(prev) || prev === 0) return { label: "—", tone: "none" };
  if (!Number.isFinite(cur)) return { label: "—", tone: "none" };
  const pct = ((cur - prev) / prev) * 100;
  if (pct === 0) return { label: "Same", tone: "flat" };
  const rounded = pct > 0 ? Math.floor(pct) : Math.ceil(pct);
  if (rounded > 0) return { label: `Up ${rounded}%`, tone: "up" };
  if (rounded < 0) return { label: `Down ${Math.abs(rounded)}%`, tone: "down" };
  // Non-zero but rounds to 0 (e.g. 0.4%) — treat as flat.
  return { label: "Same", tone: "flat" };
}

/** Axis / bar short labels like ₱500K / ₱1.0M / ₱274K (compact, always with ₱). */
export function formatSalesAxisPeso(amount: number): string {
  const n = Math.abs(Number(amount));
  if (!Number.isFinite(n) || n <= 0) return "₱0";
  // Prefer one decimal on whole millions so 1_000_000 → ₱1.0M (brief example).
  if (n >= 1_000_000 && Number.isInteger(n / 1_000_000)) {
    return `₱${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000 && n < 1_000_000 && Number.isInteger(n / 1_000)) {
    return `₱${n / 1_000}K`;
  }
  // Near-thousand amounts (e.g. 274_400) → round to whole ₱K for bar labels.
  if (n >= 1_000 && n < 1_000_000) {
    const k = Math.round(n / 1_000);
    if (k >= 1000) return `₱${(k / 1000).toFixed(1)}M`;
    return `₱${k}K`;
  }
  return formatCompactPesoLimit(n);
}

/** Default Y max when every month is 0 / empty (keeps 2 clean gridlines, no NaN). */
export const SALES_AXIS_EMPTY_MAX = 1_000;

/**
 * Clean round ceiling just above `maxAmount` for the Sales chart Y scale.
 * e.g. 274_000 → 300_000. Zero / non-finite → {@link SALES_AXIS_EMPTY_MAX}.
 */
export function niceSalesMax(maxAmount: number): number {
  const n = Number(maxAmount);
  if (!Number.isFinite(n) || n <= 0) return SALES_AXIS_EMPTY_MAX;
  const exp = Math.floor(Math.log10(n));
  const base = 10 ** exp;
  const frac = n / base;
  // Steps dense enough that 274K → 300K (not 500K).
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const niceFrac = steps.find((s) => s >= frac - 1e-12) ?? 10;
  const nice = niceFrac * base;
  return Number.isFinite(nice) && nice > 0 ? nice : SALES_AXIS_EMPTY_MAX;
}

/** Two Y gridlines: middle and top (= nice max). */
export function salesAxisTicks(maxAmount: number): number[] {
  const nice = niceSalesMax(maxAmount);
  const mid = nice / 2;
  return mid > 0 && mid < nice ? [mid, nice] : [nice];
}

export type SalesCustomerTotal = {
  customerId: string;
  name: string;
  amount: string; // ₱ string with cents
};

/**
 * Top `limit` customers by billed amount (desc). Ties break by name (asc) then
 * id so the list is stable. Returns fewer than `limit` when there aren't enough.
 */
export function topSalesCustomers(
  rows: readonly SalesCustomerTotal[],
  limit = 3,
): SalesCustomerTotal[] {
  const sorted = [...rows].sort((a, b) => {
    const ac = toScaled(a.amount, 2);
    const bc = toScaled(b.amount, 2);
    if (ac !== bc) return ac > bc ? -1 : 1;
    const byName = a.name.localeCompare(b.name, "en");
    if (byName !== 0) return byName;
    return a.customerId.localeCompare(b.customerId);
  });
  return sorted.slice(0, limit).filter((r) => toScaled(r.amount, 2) > 0n);
}

export function sumSalesAmounts(amounts: readonly string[]): string {
  let cents = 0n;
  for (const a of amounts) cents += toScaled(a, 2);
  return fromScaled(cents, 2);
}

export function isSalesEmpty(months: readonly { amount: string }[]): boolean {
  return months.every((m) => toScaled(m.amount, 2) <= 0n);
}

export type HomeSalesMonth = {
  key: MonthKey;
  shortLabel: string;
  /** Year shown under/beside the short label when the year changes. */
  yearLabel: string | null;
  amount: string;
  isCurrent: boolean;
};

export type HomeSalesCustomer = {
  customerId: string;
  name: string;
  amount: string;
  href: string;
};

export type HomeSales = {
  href: string;
  months: HomeSalesMonth[];
  /** Last 6 months (narrow view); same objects as a slice of `months`. */
  monthsNarrow: HomeSalesMonth[];
  thisMonth: string;
  lastMonth: string;
  change: { label: string; tone: "up" | "down" | "flat" | "none" };
  thisYear: string;
  topCustomers: HomeSalesCustomer[];
  empty: boolean;
  axisTicks: number[];
};
