// Home Sales loaders. Gross sales = the same Non-VAT source: non-voided
// Billing.amount by invoiceDate (see billingsGrossSales / getGrossSalesYtd).
// One findMany covers the 12-month chart and top customers; year total reuses
// getGrossSalesYtd so it never disagrees with the Non-VAT meter.

import { money } from "../documents/common";
import { db } from "../db";
import { getGrossSalesYtd, grossSalesYtdEnd, taxYearStart } from "../services/non-vat";
import { getSettingsSnapshot } from "../settings";
import { ymdToDate } from "../tax/quarters";
import { dateYmd } from "../billing/dates";
import { fromScaled, toScaled } from "../quotes/calc";
import {
  canShowHomeSales,
  isSalesEmpty,
  lastNMonthKeys,
  manilaMonthKey,
  monthKeyBounds,
  salesAxisTicks,
  salesChangeVsLastMonth,
  salesMonthLabel,
  shiftMonthKey,
  topSalesCustomers,
  type HomeSales,
  type HomeSalesMonth,
  type MonthKey,
} from "./sales";
import { nonVatHref } from "./hrefs";
import type { PermissionUser } from "../permissions";

function customerHref(id: string): string {
  return `/customers/${id}`;
}

/**
 * Load the Home Sales section for users with billing access. Returns null when
 * the viewer cannot manage billing (Staff / Viewer).
 */
export async function loadHomeSales(
  user: PermissionUser,
  opts: { now?: Date } = {},
): Promise<HomeSales | null> {
  if (!canShowHomeSales(user)) return null;
  const now = opts.now ?? new Date();
  const { settings } = await getSettingsSnapshot();
  const taxYear = settings.taxYear.year;

  const monthKeys = lastNMonthKeys(now, 12);
  const firstKey = monthKeys[0]!;
  const chartFrom = ymdToDate(monthKeyBounds(firstKey).fromYmd);
  const yearFrom = taxYearStart(taxYear);
  // One window covering both the 12-month chart and YTD top customers.
  const from = chartFrom < yearFrom ? chartFrom : yearFrom;
  const to = grossSalesYtdEnd(now, taxYearStart(taxYear + 1));

  const [rows, thisYear] = await Promise.all([
    db.billing.findMany({
      where: {
        status: { not: "VOID" },
        invoiceDate: { gte: from, lt: to },
      },
      select: {
        amount: true,
        invoiceDate: true,
        customerId: true,
        customer: { select: { id: true, name: true } },
      },
    }),
    // Same YTD total as the Non-VAT meter (identical helper + source).
    getGrossSalesYtd(taxYear, now),
  ]);

  const byMonth = new Map<MonthKey, bigint>();
  for (const k of monthKeys) byMonth.set(k, 0n);

  const byCustomer = new Map<string, { name: string; cents: bigint }>();
  const yearStartYmd = `${taxYear}-01-01`;
  const yearEndExclusive = taxYearStart(taxYear + 1);

  for (const r of rows) {
    const ymd = dateYmd(r.invoiceDate);
    const key = ymd.slice(0, 7) as MonthKey;
    const cents = toScaled(money(r.amount), 2);
    if (byMonth.has(key)) byMonth.set(key, (byMonth.get(key) ?? 0n) + cents);

    // Top customers: tax-year YTD only (same window as Non-VAT).
    if (r.invoiceDate >= yearFrom && r.invoiceDate < yearEndExclusive && ymd >= yearStartYmd) {
      const cur = byCustomer.get(r.customerId) ?? { name: r.customer.name, cents: 0n };
      cur.cents += cents;
      byCustomer.set(r.customerId, cur);
    }
  }

  const currentKey = manilaMonthKey(now);
  const months: HomeSalesMonth[] = monthKeys.map((key, i) => {
    const prev = i > 0 ? monthKeys[i - 1]! : null;
    const label = salesMonthLabel(key, prev);
    return {
      key,
      shortLabel: label.short,
      yearLabel: label.showYear ? String(label.year) : null,
      amount: fromScaled(byMonth.get(key) ?? 0n, 2),
      isCurrent: key === currentKey,
    };
  });

  const thisMonth = months[months.length - 1]?.amount ?? "0.00";
  const lastMonthKey = shiftMonthKey(currentKey, -1);
  const lastMonth = fromScaled(byMonth.get(lastMonthKey) ?? 0n, 2);
  const change = salesChangeVsLastMonth(thisMonth, lastMonth);

  const top = topSalesCustomers(
    [...byCustomer.entries()].map(([customerId, v]) => ({
      customerId,
      name: v.name,
      amount: fromScaled(v.cents, 2),
    })),
    3,
  );

  const maxMonth = Math.max(0, ...months.map((m) => Number(m.amount)));

  return {
    href: nonVatHref(),
    months,
    monthsNarrow: months.slice(-6),
    thisMonth,
    lastMonth,
    change,
    thisYear: Number.isFinite(thisYear) && thisYear > 0 ? thisYear.toFixed(2) : "0.00",
    topCustomers: top.map((c) => ({
      customerId: c.customerId,
      name: c.name,
      amount: c.amount,
      href: customerHref(c.customerId),
    })),
    empty: isSalesEmpty(months),
    axisTicks: salesAxisTicks(maxMonth),
  };
}
