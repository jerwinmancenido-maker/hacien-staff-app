// Home dashboard read model. Action counts match filtered list lengths; money
// totals use uncapped DB aggregates with the same filters as the list pages
// (lists themselves stay take:200 for paging).

import { arAgingSummary, listBillings, sumCollectionsReceived } from "../billing/views";
import { currentMonthPeriod } from "../books/period";
import { isBooksEnabled } from "../books/features";
import { isCashEnabled } from "../cash/features";
import { db } from "../db";
import { addDays, formatDate, isoDate, manilaToday } from "../format";
import { isPayablesEnabled } from "../payables/features";
import { listSupplierBillsDueSoon } from "../payables/views";
import { can, canSeeCosts, type PermissionUser } from "../permissions";
import { listReceivingView, listPurchaseOrdersView } from "../purchasing/views";
import { listQuotesView, listSalesOrdersView } from "../quotes/views";
import { listCustomers } from "../services/companies";
import { getSettingsSnapshot } from "../settings";
import { getNonVatMeter, formatNonVatPctLabel, NON_VAT_MESSAGES } from "../services/non-vat";
import { listTaxCalendar } from "../services/tax-calendar";
import { fromScaled, toScaled } from "../quotes/calc";
import { listRecentHomeActivity, type HomeActivityItem } from "./activity";
import {
  auditLogHref,
  billingsOverdueHref,
  billsOverPoHref,
  collectedThisMonthHref,
  customersNoWithholdingHref,
  newBillingHref,
  newCustomerHref,
  newQuoteHref,
  nonVatHref,
  owedByCustomersHref,
  posAwaitingReceiptHref,
  quotesNeedsApprovalHref,
  quotesNoReplyHref,
  salesOrdersNeedsPoHref,
  supplierBillsDueSoonHref,
  taxCalendarHref,
} from "./hrefs";
import { hasOverdueOwed, owedByCustomersSplit, sumPesoAmounts } from "./money";
import { loadHomeSales } from "./sales-data";
import {
  manilaMonthKey,
  owedOverdueChip,
  salesMonthLabel,
  salesMonthsRangeLabel,
  salesVsLastMonthCaption,
  shiftMonthKey,
  type HomeSales,
} from "./sales";
import {
  canShowActionRow,
  canShowMoneyFigure,
  isHomeEmpty,
  showTaxDeadline,
  type HomeActionKind,
  type HomeFeatureFlags,
  type HomeMoneyKind,
} from "./visibility";

export type HomeActionRow = {
  kind: HomeActionKind;
  label: string;
  count: number;
  href: string;
};

export type HomeMoneyRow = {
  kind: HomeMoneyKind;
  label: string;
  href: string;
  /** Primary amount (₱ string). */
  amount: string;
  /** Optional overdue slice for owed-by-customers (shown in red). */
  overdueAmount?: string;
  showOverdueRed?: boolean;
};

export type HomeTaxDeadline = {
  form: string;
  description: string;
  dueLabel: string;
  /** e.g. "Due Mon, Nov 16, 2026 · in 16 days" */
  dueDetail: string;
  dueYmd: string | null;
  /** Uppercase month abbr for the date badge (NOV). */
  badgeMonth: string | null;
  /** Day-of-month for the date badge (16). */
  badgeDay: string | null;
  overdueUnfiledCount: number;
  href: string;
};

export type HomeNonVat = {
  year: number;
  used: number;
  limit: number;
  pctLabel: string;
  barPct: number;
  level: string;
  warning: string | null;
  /** From Settings → Tax year (defaults 70 / 90). */
  warnFirstPct: number;
  warnSecondPct: number;
  href: string;
};

export type HomeKpiChange = {
  label: string;
  tone: "up" | "down" | "flat" | "none";
};

export type HomeKpis = {
  billedThisMonth: {
    amount: string;
    change: HomeKpiChange;
    vsCaption: string;
    href: string;
  };
  owedByCustomers: {
    amount: string;
    overdueChip: { label: string; tone: "overdue" } | null;
    billingCount: number;
    billingCountLabel: string;
    href: string;
  };
  collectedThisMonth: {
    amount: string;
    caption: string;
    href: string;
  };
  billedThisYear: {
    amount: string;
    barPct: number;
    pctLabel: string;
    limitLabel: string;
    href: string;
  };
};

export type HomeHeaderActions = {
  newQuoteHref: string | null;
  newBillingHref: string | null;
};

export type HomeDashboard = {
  empty: boolean;
  gettingStarted: { addCustomerHref: string; makeQuoteHref: string } | null;
  actions: HomeActionRow[];
  openActionCount: number;
  /** Sales chart + figures; null when the viewer lacks billing access. */
  sales: HomeSales | null;
  /** KPI strip; null without manage_billing (same gate as sales). */
  kpis: HomeKpis | null;
  header: HomeHeaderActions;
  money: HomeMoneyRow[];
  tax: HomeTaxDeadline | null;
  nonVat: HomeNonVat;
  recent: HomeActivityItem[];
  auditHref: string;
  features: HomeFeatureFlags;
  withCosts: boolean;
};

const ACTION_LABELS: Record<HomeActionKind, string> = {
  quotesNeedsApproval: "Quotes waiting for approval",
  quotesNoReply: "Quotes sent with no reply after 7 days",
  salesOrdersNeedsPo: "Sales orders with lines that have no PO yet",
  posAwaitingReceipt: "POs waiting to be received",
  billsOverPo: "Supplier bills higher than their PO",
  billingsOverdue: "Billings past due",
  customersNoWithholding: "Customers with no withholding type set",
};

const BADGE_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

function moneyRow(
  kind: HomeMoneyKind,
  label: string,
  href: string,
  amount: string,
  extra?: Partial<HomeMoneyRow>,
): HomeMoneyRow {
  return { kind, label, href, amount, ...extra };
}

function formatWeekdayLongDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

function daysUntilYmd(ymd: string, now: Date): number {
  const today = manilaToday(now);
  const due = new Date(`${ymd}T00:00:00.000Z`);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function taxBadge(dueYmd: string | null): { badgeMonth: string | null; badgeDay: string | null } {
  if (!dueYmd || !/^\d{4}-\d{2}-\d{2}$/.test(dueYmd)) return { badgeMonth: null, badgeDay: null };
  const month = Number(dueYmd.slice(5, 7));
  const day = dueYmd.slice(8, 10);
  return { badgeMonth: BADGE_MONTHS[month - 1] ?? null, badgeDay: String(Number(day)) };
}

function buildTaxDetail(dueYmd: string | null, now: Date): string {
  if (!dueYmd) return "No upcoming date";
  const days = daysUntilYmd(dueYmd, now);
  const when = formatWeekdayLongDate(dueYmd);
  if (days < 0) {
    const n = Math.abs(days);
    return `Due ${when} · ${n} ${n === 1 ? "day" : "days"} overdue`;
  }
  if (days === 0) return `Due ${when} · today`;
  return `Due ${when} · in ${days} ${days === 1 ? "day" : "days"}`;
}

function monthShortLabel(now: Date): string {
  const key = manilaMonthKey(now);
  return salesMonthLabel(key, null).short;
}

function buildKpis(opts: {
  sales: HomeSales;
  owedAmount: string;
  overdueCount: number;
  openCount: number;
  collected: string;
  nonVat: HomeNonVat;
  now: Date;
}): HomeKpis {
  const { sales, owedAmount, overdueCount, openCount, collected, nonVat, now } = opts;
  const lastKey = shiftMonthKey(manilaMonthKey(now), -1);
  const collectedNum = Number(collected);
  const mon = monthShortLabel(now);
  const collectedCaption =
    !Number.isFinite(collectedNum) || collectedNum <= 0
      ? `No payments recorded in ${mon}`
      : `Posted collections in ${mon}`;

  const billingCount = openCount;
  const billingCountLabel =
    billingCount === 1 ? "1 billing" : `${billingCount.toLocaleString("en-US")} billings`;

  return {
    billedThisMonth: {
      amount: sales.thisMonth,
      change: sales.change,
      vsCaption: salesVsLastMonthCaption(sales.lastMonth, lastKey),
      href: sales.href,
    },
    owedByCustomers: {
      amount: owedAmount,
      overdueChip: owedOverdueChip(overdueCount, openCount),
      billingCount,
      billingCountLabel,
      href: owedByCustomersHref(),
    },
    collectedThisMonth: {
      amount: collected,
      caption: collectedCaption,
      href: collectedThisMonthHref(now),
    },
    billedThisYear: {
      amount: sales.thisYear,
      barPct: nonVat.barPct,
      pctLabel: nonVat.pctLabel,
      limitLabel: `of Non-VAT ${formatCompactLimit(nonVat.limit)}`,
      href: nonVat.href,
    },
  };
}

function formatCompactLimit(limit: number): string {
  if (limit >= 1_000_000 && limit % 1_000_000 === 0) return `₱${limit / 1_000_000}M`;
  if (limit >= 1_000 && limit % 1_000 === 0) return `₱${limit / 1_000}K`;
  return `₱${new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 }).format(limit)}`;
}

function headerActions(user: PermissionUser): HomeHeaderActions {
  return {
    newQuoteHref: can(user, "edit_data") ? newQuoteHref() : null,
    newBillingHref: can(user, "manage_billing") ? newBillingHref() : null,
  };
}

export async function loadHomeDashboard(
  user: PermissionUser,
  opts: { now?: Date } = {},
): Promise<HomeDashboard> {
  const now = opts.now ?? new Date();
  const withCosts = canSeeCosts(user);
  const [payablesEnabled, cashEnabled, booksEnabled] = await Promise.all([
    isPayablesEnabled(),
    isCashEnabled(),
    isBooksEnabled(),
  ]);
  const features: HomeFeatureFlags = { payablesEnabled, cashEnabled, booksEnabled };
  const header = headerActions(user);

  const customerCount = await db.customer.count({ where: { active: true } });
  if (isHomeEmpty(customerCount)) {
    const { settings } = await getSettingsSnapshot();
    const [meter, sales] = await Promise.all([
      getNonVatMeter(settings.taxYear, now),
      loadHomeSales(user, { now }),
    ]);
    const nonVat: HomeNonVat = {
      year: meter.year,
      used: meter.used,
      limit: meter.limit,
      pctLabel: formatNonVatPctLabel(meter.pct),
      barPct: meter.barPct,
      level: meter.level,
      warning: NON_VAT_MESSAGES[meter.level],
      warnFirstPct: meter.warnFirstPct,
      warnSecondPct: meter.warnSecondPct,
      href: nonVatHref(),
    };
    const salesOut =
      sales == null ? null : { ...sales, rangeLabel: sales.rangeLabel ?? salesMonthsRangeLabel(sales.months) };
    return {
      empty: true,
      gettingStarted: { addCustomerHref: newCustomerHref(), makeQuoteHref: newQuoteHref() },
      actions: [],
      openActionCount: 0,
      sales: salesOut,
      kpis: salesOut
        ? buildKpis({
            sales: salesOut,
            owedAmount: "0.00",
            overdueCount: 0,
            openCount: 0,
            collected: "0.00",
            nonVat,
            now,
          })
        : null,
      header,
      money: [],
      tax: null,
      nonVat,
      recent: [],
      auditHref: auditLogHref(),
      features,
      withCosts,
    };
  }

  const period = currentMonthPeriod(now);

  const [
    quotesNeedsApproval,
    quotesNoReply,
    salesOrdersNeedsPo,
    receiving,
    billingsOverdue,
    customersNoWh,
    ar,
    collected,
    nonVatSnap,
    sales,
    recent,
  ] = await Promise.all([
    listQuotesView({ needsApproval: true, now }, user),
    listQuotesView({ noReplyAfterDays: 7, now }, user),
    listSalesOrdersView({ needsPo: true }),
    listReceivingView({ history: false }, user),
    // OVERDUE filters before take:200 — same page Home links to.
    listBillings({ status: "OVERDUE" }),
    listCustomers({ withholding: "NONE" }),
    arAgingSummary(),
    sumCollectionsReceived({ status: "POSTED", fromYmd: period.fromYmd, toYmd: period.toYmd }),
    getSettingsSnapshot().then((s) => getNonVatMeter(s.settings.taxYear, now)),
    loadHomeSales(user, { now }),
    listRecentHomeActivity(5, { withCosts }),
  ]);

  // Same list as /receiving (Awaiting delivery).
  const posAwaiting = receiving.length;

  let billsOverPoCount = 0;
  if (withCosts) {
    const over = await listPurchaseOrdersView({ billedOver: true }, user);
    billsOverPoCount = over.length;
  }

  const actionCounts: Record<HomeActionKind, { count: number; href: string }> = {
    quotesNeedsApproval: { count: quotesNeedsApproval.length, href: quotesNeedsApprovalHref() },
    quotesNoReply: { count: quotesNoReply.length, href: quotesNoReplyHref() },
    salesOrdersNeedsPo: { count: salesOrdersNeedsPo.length, href: salesOrdersNeedsPoHref() },
    posAwaitingReceipt: { count: posAwaiting, href: posAwaitingReceiptHref() },
    billsOverPo: { count: billsOverPoCount, href: billsOverPoHref() },
    billingsOverdue: { count: billingsOverdue.length, href: billingsOverdueHref() },
    customersNoWithholding: { count: customersNoWh.length, href: customersNoWithholdingHref() },
  };

  const actions: HomeActionRow[] = (Object.keys(ACTION_LABELS) as HomeActionKind[])
    .filter((kind) => canShowActionRow(kind, actionCounts[kind].count, user))
    .map((kind) => ({
      kind,
      label: ACTION_LABELS[kind],
      count: actionCounts[kind].count,
      href: actionCounts[kind].href,
    }));

  const openActionCount = actions.reduce((sum, a) => sum + a.count, 0);

  const owed = owedByCustomersSplit(ar.totalReceivable, ar.overdue);

  const money: HomeMoneyRow[] = [];
  if (canShowMoneyFigure("owedByCustomers", user, features)) {
    money.push(
      moneyRow("owedByCustomers", "Owed by customers", owedByCustomersHref(), owed.total, {
        overdueAmount: owed.overdue,
        showOverdueRed: hasOverdueOwed(owed),
      }),
    );
  }
  if (canShowMoneyFigure("collectedThisMonth", user, features)) {
    money.push(moneyRow("collectedThisMonth", "Collected this month", collectedThisMonthHref(now), collected));
  }
  // "Billed this month" lives under Sales / KPIs (billing access only), not Money.
  if (canShowMoneyFigure("supplierBillsDueSoon", user, features)) {
    const dueSoon = await listSupplierBillsDueSoon(7, now);
    const dueTotal = sumPesoAmounts(dueSoon.map((b) => b.balance));
    money.push(
      moneyRow("supplierBillsDueSoon", "Supplier bills due in the next 7 days", supplierBillsDueSoonHref(now), dueTotal),
    );
  }

  const nonVat: HomeNonVat = {
    year: nonVatSnap.year,
    used: nonVatSnap.used,
    limit: nonVatSnap.limit,
    pctLabel: formatNonVatPctLabel(nonVatSnap.pct),
    barPct: nonVatSnap.barPct,
    level: nonVatSnap.level,
    warning: NON_VAT_MESSAGES[nonVatSnap.level],
    warnFirstPct: nonVatSnap.warnFirstPct,
    warnSecondPct: nonVatSnap.warnSecondPct,
    href: nonVatHref(),
  };

  const kpis =
    sales != null
      ? buildKpis({
          sales,
          owedAmount: owed.total,
          overdueCount: ar.overdueCount,
          openCount: ar.openCount,
          collected,
          nonVat,
          now,
        })
      : null;

  let tax: HomeTaxDeadline | null = null;
  if (showTaxDeadline(features, user)) {
    const cal = await listTaxCalendar(user, { view: "upcoming", now });
    const overdueUnfiled = cal.rows.filter((r) => r.status === "overdue" && !r.markedDone).length;
    const next = cal.rows.find(
      (r) => !r.markedDone && r.applies !== "does_not_apply" && r.dueYmd && r.status !== "overdue",
    ) ?? cal.rows.find((r) => !r.markedDone && r.applies !== "does_not_apply");
    if (next || overdueUnfiled > 0) {
      const dueYmd = next?.dueYmd ?? null;
      const badge = taxBadge(dueYmd);
      tax = {
        form: next?.form ?? "Tax calendar",
        description: next?.description ?? "Open the tax calendar",
        dueLabel: dueYmd ? formatDate(new Date(`${dueYmd}T00:00:00.000Z`)) : "No upcoming date",
        dueDetail: buildTaxDetail(dueYmd, now),
        dueYmd,
        badgeMonth: badge.badgeMonth,
        badgeDay: badge.badgeDay,
        overdueUnfiledCount: overdueUnfiled,
        href: taxCalendarHref(),
      };
    }
  }

  const salesWithRange =
    sales == null
      ? null
      : { ...sales, rangeLabel: salesMonthsRangeLabel(sales.months) };

  return {
    empty: false,
    gettingStarted: null,
    actions,
    openActionCount,
    sales: salesWithRange,
    kpis,
    header,
    money,
    tax,
    nonVat,
    recent,
    auditHref: auditLogHref(),
    features,
    withCosts,
  };
}

/** Re-export for tests that assert month bounds in PHT. */
export function homeMonthBounds(now: Date = new Date()) {
  return currentMonthPeriod(now);
}

export function homeTodayPlusDaysYmd(days: number, now: Date = new Date()) {
  return isoDate(addDays(manilaToday(now), days));
}

/** Sum helper used by parity tests (same cent math as the dashboard). */
export function homeSumAmounts(amounts: readonly string[]): string {
  return sumPesoAmounts(amounts);
}

export function homeOwedSplit(total: string, overdue: string) {
  return owedByCustomersSplit(total, overdue);
}

export { can, canSeeCosts, toScaled, fromScaled };
