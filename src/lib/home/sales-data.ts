// Home Sales loaders.
// Chart + Sales KPI = confirmed SO contractPrice by SO `date` (OPEN|CLOSED,
// businessId null, Asia/Manila). Billed KPIs / year total stay on non-void
// billings (same Non-VAT source) — do not change the ₱3M meter here.

import { money } from "../documents/common";
import { db } from "../db";
import { getGrossSalesYtd, grossSalesYtdEnd, taxYearStart } from "../services/non-vat";
import { getSettingsSnapshot } from "../settings";
import { ymdToDate } from "../tax/quarters";
import { dateYmd } from "../billing/dates";
import { fromScaled, toScaled } from "../quotes/calc";
import {
  canShowHomeSales,
  confirmedSoUnbilledTotal,
  isSalesEmpty,
  lastNMonthKeys,
  manilaDayOfMonth,
  manilaMonthKey,
  monthKeyBounds,
  mtdVsSameDaysChip,
  salesAxisTicks,
  salesMonthLabel,
  salesMonthsRangeLabel,
  sameDaysEndYmd,
  shiftMonthKey,
  topSalesCustomers,
  type HomeSales,
  type HomeSalesMonth,
  type MonthKey,
} from "./sales";
import { CONFIRMED_SALES_ORDER_STATUSES } from "./pipeline";
import { salesOrdersListHref } from "./hrefs";
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

  const currentKey = manilaMonthKey(now);
  const lastMonthKey = shiftMonthKey(currentKey, -1);
  const mtdDay = manilaDayOfMonth(now);
  const priorSameDaysEnd = sameDaysEndYmd(lastMonthKey, mtdDay);
  const yearStartYmd = `${taxYear}-01-01`;
  const yearEndExclusive = taxYearStart(taxYear + 1);

  const [soRows, billingRows, thisYear] = await Promise.all([
    // Confirmed SOs only (HACIEN = businessId null). Sale date = SO `date`.
    db.salesOrder.findMany({
      where: {
        status: { in: [...CONFIRMED_SALES_ORDER_STATUSES] },
        businessId: null,
        date: { gte: from, lt: to },
      },
      select: {
        contractPrice: true,
        date: true,
        customerId: true,
        customer: { select: { id: true, name: true } },
      },
    }),
    // Billed KPI MTD: same non-void / invoiceDate filter as before (entity
    // filter left as-is — separate ticket). Year total uses getGrossSalesYtd.
    db.billing.findMany({
      where: {
        status: { not: "VOID" },
        invoiceDate: { gte: from, lt: to },
      },
      select: {
        amount: true,
        invoiceDate: true,
      },
    }),
    getGrossSalesYtd(taxYear, now),
  ]);

  const byMonth = new Map<MonthKey, bigint>();
  for (const k of monthKeys) byMonth.set(k, 0n);

  const byCustomer = new Map<string, { name: string; cents: bigint }>();
  let lastMonthSameDaysCents = 0n;
  let thisMonthOrderCount = 0;

  for (const r of soRows) {
    const ymd = dateYmd(r.date);
    const key = ymd.slice(0, 7) as MonthKey;
    const cents = toScaled(money(r.contractPrice), 2);
    if (byMonth.has(key)) byMonth.set(key, (byMonth.get(key) ?? 0n) + cents);

    if (key === currentKey) thisMonthOrderCount += 1;

    if (key === lastMonthKey && ymd <= priorSameDaysEnd) {
      lastMonthSameDaysCents += cents;
    }

    // Top customers: tax-year YTD confirmed SO value.
    if (r.date >= yearFrom && r.date < yearEndExclusive && ymd >= yearStartYmd) {
      const cur = byCustomer.get(r.customerId) ?? { name: r.customer.name, cents: 0n };
      cur.cents += cents;
      byCustomer.set(r.customerId, cur);
    }
  }

  let billedThisMonthCents = 0n;
  let billedLastMonthSameDaysCents = 0n;
  for (const r of billingRows) {
    const ymd = dateYmd(r.invoiceDate);
    const key = ymd.slice(0, 7) as MonthKey;
    const cents = toScaled(money(r.amount), 2);
    if (key === currentKey) billedThisMonthCents += cents;
    if (key === lastMonthKey && ymd <= priorSameDaysEnd) {
      billedLastMonthSameDaysCents += cents;
    }
  }

  const months: HomeSalesMonth[] = monthKeys.map((key, i) => {
    const prev = i > 0 ? monthKeys[i - 1]! : null;
    const label = salesMonthLabel(key, prev);
    const isCurrent = key === currentKey;
    return {
      key,
      shortLabel: label.short,
      yearLabel: label.showYear ? String(label.year) : null,
      amount: fromScaled(byMonth.get(key) ?? 0n, 2),
      isCurrent,
      isPartial: isCurrent,
    };
  });

  const thisMonth = months[months.length - 1]?.amount ?? "0.00";
  const lastMonth = fromScaled(byMonth.get(lastMonthKey) ?? 0n, 2);
  const lastMonthSameDays = fromScaled(lastMonthSameDaysCents, 2);
  const mtdChip = mtdVsSameDaysChip(thisMonth, lastMonthSameDays, lastMonthKey, mtdDay);
  const change = mtdChip?.change ?? { label: "—", tone: "none" as const };

  const billedThisMonth = fromScaled(billedThisMonthCents, 2);
  const billedLastMonthSameDays = fromScaled(billedLastMonthSameDaysCents, 2);
  const billedMtdChip = mtdVsSameDaysChip(
    billedThisMonth,
    billedLastMonthSameDays,
    lastMonthKey,
    mtdDay,
  );

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
    href: salesOrdersListHref(),
    months,
    monthsNarrow: months.slice(-6),
    thisMonth,
    orderCount: thisMonthOrderCount,
    lastMonth,
    lastMonthSameDays,
    mtdDay,
    change,
    mtdChip,
    billedThisMonth,
    billedLastMonthSameDays,
    billedMtdChip,
    thisYear: Number.isFinite(thisYear) && thisYear > 0 ? thisYear.toFixed(2) : "0.00",
    topCustomers: top.map((c) => ({
      customerId: c.customerId,
      name: c.name,
      amount: c.amount,
      href: customerHref(c.customerId),
    })),
    empty: isSalesEmpty(months),
    axisTicks: salesAxisTicks(maxMonth),
    rangeLabel: salesMonthsRangeLabel(months),
  };
}

/**
 * Confirmed SO contractPrice not yet covered by non-void billings (HACIEN only).
 * Used under the Sales Milestone meter — does not change what the meter counts.
 */
export async function loadConfirmedUnbilledSoTotal(): Promise<string> {
  const rows = await db.salesOrder.findMany({
    where: {
      status: { in: [...CONFIRMED_SALES_ORDER_STATUSES] },
      businessId: null,
    },
    select: {
      contractPrice: true,
      billings: { where: { status: { not: "VOID" } }, select: { amount: true } },
    },
  });
  return confirmedSoUnbilledTotal(
    rows.map((r) => ({
      contractPrice: money(r.contractPrice),
      billingAmounts: r.billings.map((b) => money(b.amount)),
    })),
  );
}
