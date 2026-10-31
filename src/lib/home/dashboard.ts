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
  billingsOverdueHref,
  billsOverPoHref,
  collectedThisMonthHref,
  customersNoWithholdingHref,
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
import type { HomeSales } from "./sales";
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
  dueYmd: string | null;
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

export type HomeDashboard = {
  empty: boolean;
  gettingStarted: { addCustomerHref: string; makeQuoteHref: string } | null;
  actions: HomeActionRow[];
  /** Sales chart + figures; null when the viewer lacks billing access. */
  sales: HomeSales | null;
  money: HomeMoneyRow[];
  tax: HomeTaxDeadline | null;
  nonVat: HomeNonVat;
  recent: HomeActivityItem[];
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

function moneyRow(
  kind: HomeMoneyKind,
  label: string,
  href: string,
  amount: string,
  extra?: Partial<HomeMoneyRow>,
): HomeMoneyRow {
  return { kind, label, href, amount, ...extra };
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

  const customerCount = await db.customer.count({ where: { active: true } });
  if (isHomeEmpty(customerCount)) {
    const { settings } = await getSettingsSnapshot();
    const [meter, sales] = await Promise.all([
      getNonVatMeter(settings.taxYear, now),
      loadHomeSales(user, { now }),
    ]);
    return {
      empty: true,
      gettingStarted: { addCustomerHref: newCustomerHref(), makeQuoteHref: newQuoteHref() },
      actions: [],
      sales,
      money: [],
      tax: null,
      nonVat: {
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
      },
      recent: [],
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
    listRecentHomeActivity(5),
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
  // "Billed this month" lives under Sales (billing access only), not Money.
  if (canShowMoneyFigure("supplierBillsDueSoon", user, features)) {
    const dueSoon = await listSupplierBillsDueSoon(7, now);
    const dueTotal = sumPesoAmounts(dueSoon.map((b) => b.balance));
    money.push(
      moneyRow("supplierBillsDueSoon", "Supplier bills due in the next 7 days", supplierBillsDueSoonHref(now), dueTotal),
    );
  }

  let tax: HomeTaxDeadline | null = null;
  if (showTaxDeadline(features, user)) {
    const cal = await listTaxCalendar(user, { view: "upcoming", now });
    const overdueUnfiled = cal.rows.filter((r) => r.status === "overdue" && !r.markedDone).length;
    const next = cal.rows.find(
      (r) => !r.markedDone && r.applies !== "does_not_apply" && r.dueYmd && r.status !== "overdue",
    ) ?? cal.rows.find((r) => !r.markedDone && r.applies !== "does_not_apply");
    if (next || overdueUnfiled > 0) {
      tax = {
        form: next?.form ?? "Tax calendar",
        description: next?.description ?? "Open the tax calendar",
        dueLabel: next?.dueYmd ? formatDate(new Date(`${next.dueYmd}T00:00:00.000Z`)) : "No upcoming date",
        dueYmd: next?.dueYmd ?? null,
        overdueUnfiledCount: overdueUnfiled,
        href: taxCalendarHref(),
      };
    }
  }

  return {
    empty: false,
    gettingStarted: null,
    actions,
    sales,
    money,
    tax,
    nonVat: {
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
    },
    recent,
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
