// Display formatting. Money is pesos (₱1,234.56); dates are shown in Asia/Manila.

export const TIME_ZONE = "Asia/Manila";

const pesoFormatter = new Intl.NumberFormat("en-PH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatPeso(amount: number | string | { toString(): string }): string {
  const n = typeof amount === "number" ? amount : Number(amount.toString());
  const sign = n < 0 ? "-" : "";
  return `${sign}₱${pesoFormatter.format(Math.abs(n))}`;
}

const pesoWholeFormatter = new Intl.NumberFormat("en-PH", {
  maximumFractionDigits: 0,
});

/**
 * Limits and similar whole-peso ceilings: drop ".00" when the amount is an
 * exact peso (e.g. ₱3,000,000). Fractional amounts keep two decimals.
 */
export function formatPesoLimit(amount: number | string | { toString(): string }): string {
  const n = typeof amount === "number" ? amount : Number(amount.toString());
  if (!Number.isFinite(n)) return formatPeso(0);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const cents = Math.round(abs * 100);
  if (cents % 100 === 0) {
    return `${sign}₱${pesoWholeFormatter.format(cents / 100)}`;
  }
  return formatPeso(amount);
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** e.g. "Oct 30, 2026" in Manila time. */
export function formatDate(date: Date): string {
  return dateFormatter.format(date);
}

/** e.g. "Oct 30, 2026, 8:05 AM" in Manila time. */
export function formatDateTime(date: Date): string {
  return dateTimeFormatter.format(date);
}

/** Hour of day in Manila, for the "Good morning" greeting. */
export function manilaHour(date: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", hourCycle: "h23" }).format(date),
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
}

/** Today's date in Manila as a date-only value (00:00 UTC of that calendar day), for DATE columns. */
export function manilaToday(now: Date = new Date()): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** A date-only value as YYYY-MM-DD (for <input type="date">). */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
