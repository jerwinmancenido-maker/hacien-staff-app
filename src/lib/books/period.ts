// Period helpers for Books registers. Cutoffs use Asia/Manila (PHT) calendar days.
// DATE columns are stored as UTC midnight of the Manila YMD; DateTime fields
// (and any UTC-stored instant) are converted to Manila YMD before comparing.

import { TIME_ZONE, isoDate, manilaToday } from "../format";
import { ymdCmp } from "../cash/balance";

/** Manila calendar YYYY-MM-DD for any Date / UTC instant. */
export function manilaYmdFromInstant(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Inclusive period check on a Manila YYYY-MM-DD string. */
export function ymdInPeriod(dateYmd: string, fromYmd: string, toYmd: string): boolean {
  return ymdCmp(dateYmd, fromYmd) >= 0 && ymdCmp(dateYmd, toYmd) <= 0;
}

/**
 * Inclusive period check for a Date that may be a DATE column (UTC midnight of
 * the Manila day) or a real UTC timestamp. A record at 23:59 PHT on the last
 * day is in; 00:00 PHT the next day is out.
 */
export function instantInPeriod(date: Date, fromYmd: string, toYmd: string): boolean {
  return ymdInPeriod(manilaYmdFromInstant(date), fromYmd, toYmd);
}

export type BooksPeriod = {
  fromYmd: string;
  toYmd: string;
  /** True when the caller did not pass from/to and we defaulted to the month. */
  isDefaultMonth: boolean;
};

/** First and last calendar day of the Manila month containing `today`. */
export function currentMonthPeriod(now: Date = new Date()): BooksPeriod {
  const today = manilaToday(now);
  const ymd = isoDate(today);
  const [y, m] = ymd.split("-").map(Number) as [number, number];
  const fromYmd = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const toYmd = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { fromYmd, toYmd, isDefaultMonth: true };
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Parse ?from=&to= query; invalid or missing → current Manila month. */
export function parseBooksPeriod(fromRaw?: string | null, toRaw?: string | null, now: Date = new Date()): BooksPeriod {
  const from = fromRaw && YMD.test(fromRaw) ? fromRaw : null;
  const to = toRaw && YMD.test(toRaw) ? toRaw : null;
  if (from && to && ymdCmp(from, to) <= 0) {
    return { fromYmd: from, toYmd: to, isDefaultMonth: false };
  }
  if (from && !to) {
    return { fromYmd: from, toYmd: from, isDefaultMonth: false };
  }
  return currentMonthPeriod(now);
}
