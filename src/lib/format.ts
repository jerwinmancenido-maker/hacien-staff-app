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
