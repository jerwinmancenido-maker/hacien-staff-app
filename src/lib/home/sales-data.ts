// Home Sales loaders. "Sales" = confirmed sales orders: OPEN or CLOSED
// (VOID excluded), HACIEN own-company only (businessId null — the entity
// wall), counted once per order at the gross contract price by SO date.
// The Billed KPI figures keep the Non-VAT billing source: non-voided
// Billing.amount by invoiceDate; the Billed (Year) total reuses
// getGrossSalesYtd, so the Non-VAT lockstep applies ONLY to that card.

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
  manilaDayOfMonth,
  manilaMonthKey,
  monthKeyBounds,
  mtdVsSameDaysChip,
  salesAxisTicks,
  salesMonthLabel,
  salesMonthsRangeLabel,
  sameDaysEndYmd,
  shiftMonthKey,
  summarizeConfirmedSales,
  topSalesCustomers,
  unbilledConfirmedTotal,
  type HomeSales,
  type HomeSalesMonth,
  type MonthKey,
} from "./sales";
import { salesOrdersHref } from "./hrefs";
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

  // Billed (Mon) window: the prior month (for the same-days slice) through
  // the end of the current month, by invoiceDate.
  const billedFrom = ymdToDate(monthKeyBounds(lastMonthKey).fromYmd);
  const billedTo = ymdToDate(monthKeyBounds(shiftMonthKey(currentKey, 1)).fromYmd);

  const [soRows, billingRows, billedThisYear, unbilledRows] = await Promise.all([
    // Confirmed orders only: OPEN or CLOSED (VOID excluded), own-company
    // (businessId null). Amount = contractPrice, the order's gross total.
    db.salesOrder.findMany({
      where: {
        status: { in: ["OPEN", "CLOSED"] },
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
    // Same non-void / invoiceDate filter as Non-VAT (billingsGrossSales) —
    // used ONLY for the Billed (Mon) card and its same-days chip.
    db.billing.findMany({
      where: {
        status: { not: "VOID" },
        invoiceDate: { gte: billedFrom, lt: billedTo },
      },
      select: { amount: true, invoiceDate: true },
    }),
    // Same YTD total as the Non-VAT meter (identical helper + source).
    getGrossSalesYtd(taxYear, now),
    // Every confirmed own-company order with its non-VOID billings, for the
    // "confirmed orders not yet billed" remainder on the Billed (Year) card.
    db.salesOrder.findMany({
      where: { status: { in: ["OPEN", "CLOSED"] }, businessId: null },
      select: {
        contractPrice: true,
        billings: { where: { status: { not: "VOID" } }, select: { amount: true } },
      },
    }),
  ]);

  const summary = summarizeConfirmedSales(
    soRows.map((r) => ({
      ymd: dateYmd(r.date),
      amount: money(r.contractPrice),
      customerId: r.customerId,
      customerName: r.customer.name,
    })),
    {
      monthKeys,
      lastMonthKey,
      priorSameDaysEnd,
      yearStartYmd: `${taxYear}-01-01`,
      yearEndYmd: `${taxYear + 1}-01-01`,
    },
  );

  // Billed (Mon) + its same-days prior slice, from billings only.
  let billedThisMonthCents = 0n;
  let billedPriorSameDaysCents = 0n;
  for (const r of billingRows) {
    const ymd = dateYmd(r.invoiceDate);
    const key = ymd.slice(0, 7) as MonthKey;
    const cents = toScaled(money(r.amount), 2);
    if (key === currentKey) billedThisMonthCents += cents;
    if (key === lastMonthKey && ymd <= priorSameDaysEnd) billedPriorSameDaysCents += cents;
  }
  const billedThisMonth = fromScaled(billedThisMonthCents, 2);
  const billedMtdChip = mtdVsSameDaysChip(
    billedThisMonth,
    fromScaled(billedPriorSameDaysCents, 2),
    lastMonthKey,
    mtdDay,
  );

  const months: HomeSalesMonth[] = monthKeys.map((key, i) => {
    const prev = i > 0 ? monthKeys[i - 1]! : null;
    const label = salesMonthLabel(key, prev);
    const isCurrent = key === currentKey;
    return {
      key,
      shortLabel: label.short,
      yearLabel: label.showYear ? String(label.year) : null,
      amount: summary.byMonth.get(key) ?? "0.00",
      isCurrent,
      isPartial: isCurrent,
    };
  });

  const thisMonth = months[months.length - 1]?.amount ?? "0.00";
  const lastMonth = summary.byMonth.get(lastMonthKey) ?? "0.00";
  const mtdChip = mtdVsSameDaysChip(thisMonth, summary.lastMonthSameDays, lastMonthKey, mtdDay);
  const change = mtdChip?.change ?? { label: "—", tone: "none" as const };
  const orderCount = soRows.reduce((n, r) => {
    const key = dateYmd(r.date).slice(0, 7);
    return key === currentKey ? n + 1 : n;
  }, 0);

  const top = topSalesCustomers(summary.byCustomer, 3);
  const maxMonth = Math.max(0, ...months.map((m) => Number(m.amount)));

  return {
    href: salesOrdersHref(),
    months,
    monthsNarrow: months.slice(-6),
    thisMonth,
    lastMonth,
    lastMonthSameDays: summary.lastMonthSameDays,
    mtdDay,
    change,
    mtdChip,
    thisYear: summary.thisYear,
    topCustomers: top.map((c) => ({
      customerId: c.customerId,
      name: c.name,
      amount: c.amount,
      href: customerHref(c.customerId),
    })),
    empty: isSalesEmpty(months),
    axisTicks: salesAxisTicks(maxMonth),
    rangeLabel: salesMonthsRangeLabel(months),
    billedThisMonth,
    billedMtdChip,
    billedThisYear:
      Number.isFinite(billedThisYear) && billedThisYear > 0 ? billedThisYear.toFixed(2) : "0.00",
    unbilledConfirmed: unbilledConfirmedTotal(
      unbilledRows.map((o) => ({
        contractPrice: money(o.contractPrice),
        billedAmounts: o.billings.map((b) => money(b.amount)),
      })),
    ),
    orderCount,
  };
}

/**
 * Confirmed SO contractPrice not yet covered by non-void billings (HACIEN only).
 * Used under the Sales Milestone meter — does not change what the meter counts.
 */
export async function loadConfirmedUnbilledSoTotal(): Promise<string> {
  const rows = await db.salesOrder.findMany({
    where: { status: { in: ["OPEN", "CLOSED"] }, businessId: null },
    select: {
      contractPrice: true,
      billings: { where: { status: { not: "VOID" } }, select: { amount: true } },
    },
  });
  return unbilledConfirmedTotal(
    rows.map((o) => ({
      contractPrice: money(o.contractPrice),
      billedAmounts: o.billings.map((b) => money(b.amount)),
    })),
  );
}
