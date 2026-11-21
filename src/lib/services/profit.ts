// S-53: monthly net profit + margin by deal (management view, not a BIR book).
// Definitions, stated on the page:
// - Revenue: posted, non-void billings invoiced in the month, less customer
//   returns posted in the month (F15 — a return is negative sales, dated
//   when the return happens, not when the sale was invoiced).
// - Supplier bills: non-void supplier bills recorded in the month, less
//   supplier returns posted in the month (valued at qty x PO unit cost).
// - Expenses: posted expenses dated in the month.
// - Net: revenue − supplier bills − expenses.
// - Margin by deal: sales orders dated in the month (non-void), contract
//   price less the deal's posted returns, minus supplier cost; margin % is
//   blank when the net contract price is ₱0, and also when the supplier
//   cost was never set (₱0.00 — a 100% figure would print the bookkeeping
//   placeholder as fact, D8).
import { db } from "../db";
import { money, ymd } from "../documents/common";
import { divRound, fromScaled, toScaled } from "../quotes/calc";
import { manilaToday, isoDate } from "../format";
import { supplierReturnAmount } from "./books";

export type ProfitDeal = {
  number: string;
  date: string;
  /** Contract price less the deal's posted customer returns (F15). */
  contractPrice: string;
  /** Posted customer returns on this deal, all dates (F15). */
  returns: string;
  supplierCost: string;
  margin: string;
  marginPct: string | null;
};

export type MonthlyProfit = {
  month: string;
  /** Billings invoiced in the month less customer returns posted in the month. */
  revenue: string;
  /** Customer returns posted in the month (F15). */
  customerReturns: string;
  /** Supplier bills recorded in the month less supplier returns posted in the month. */
  supplierBills: string;
  /** Supplier returns posted in the month, at qty x PO unit cost (F15). */
  supplierReturns: string;
  expenses: string;
  net: string;
  deals: ProfitDeal[];
};

/** Margin for one deal, in money strings. Pure, so it is unit-testable. */
export function dealMargin(contractPrice: string, supplierCost: string): { margin: string; marginPct: string | null } {
  const margin = toScaled(contractPrice, 2) - toScaled(supplierCost, 2);
  const price = toScaled(contractPrice, 2);
  if (price === 0n) return { margin: fromScaled(margin, 2), marginPct: null };
  // D8: ₱0.00 supplier cost means "not set" everywhere in the app
  // (supplierCostMissing, quotes/calc) — keep the peso margin (the full
  // price, as stored) but show no percent instead of a factual 100%.
  if (toScaled(supplierCost, 2) === 0n) return { margin: fromScaled(margin, 2), marginPct: null };
  // F23: round like the quotes side (divRound, half away from zero) —
  // plain BigInt division truncated, so 24.3077% showed as 24.30 on the
  // Monthly profit page while the quotes list showed 24.31.
  const pct = Number(divRound(margin * 10000n, price)) / 100;
  return { margin: fromScaled(margin, 2), marginPct: pct.toFixed(2) };
}

export function monthBounds(month: string): { from: Date; to: Date } {
  const parts = month.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  return { from, to };
}

/** "YYYY-MM" for the current month in Manila, or the given month when valid. */
export function profitMonth(raw: string | null | undefined): string {
  if (raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return raw;
  return isoDate(manilaToday()).slice(0, 7);
}

export async function getMonthlyProfit(month: string): Promise<MonthlyProfit> {
  const { from, to } = monthBounds(month);
  // Business-entity wall (PR-B, 2026-11-19): this is HACIEN's monthly
  // profit — other businesses' bills, expenses and deals are excluded
  // (they appear in the operational profit view, PR-C, under their own
  // business). Billings are own-company by construction (a tagged SO
  // cannot be billed); the SO filter is kept for symmetry and safety.
  const [billings, bills, expenses, orders, custReturns, suppReturns] = await Promise.all([
    db.billing.findMany({ where: { status: { not: "VOID" }, invoiceDate: { gte: from, lt: to }, salesOrder: { businessId: null } }, select: { amount: true } }),
    db.supplierBill.findMany({
      where: { status: { not: "VOID" }, billDate: { gte: from, lt: to }, OR: [{ purchaseOrderId: null }, { purchaseOrder: { businessId: null } }] },
      select: { amount: true },
    }),
    db.expense.findMany({ where: { status: "POSTED", date: { gte: from, lt: to }, businessId: null }, select: { amount: true } }),
    db.salesOrder.findMany({
      where: { status: { not: "VOID" }, date: { gte: from, lt: to }, businessId: null },
      select: { id: true, number: true, date: true, contractPrice: true, supplierCost: true },
      orderBy: [{ date: "asc" }, { number: "asc" }],
    }),
    // F15: returns posted in the month, own-company only (entity wall).
    db.customerReturn.findMany({
      where: { status: "POSTED", returnDate: { gte: from, lt: to }, salesOrder: { businessId: null } },
      select: { credit: { select: { amount: true } }, items: { select: { amount: true } } },
    }),
    db.supplierReturn.findMany({
      where: { status: "POSTED", returnDate: { gte: from, lt: to }, purchaseOrder: { businessId: null } },
      select: { items: { select: { qtyReturned: true, purchaseOrderItem: { select: { unitCost: true } } } } },
    }),
  ]);
  const sum = (xs: readonly { amount: number | string | { toFixed(n: number): string } }[]) => fromScaled(xs.reduce((a, x) => a + toScaled(money(x.amount), 2), 0n), 2);
  const returnTotal = (r: { credit: { amount: unknown } | null; items: { amount: unknown }[] }) =>
    r.credit ? money(r.credit.amount as never) : fromScaled(r.items.reduce((a, i) => a + toScaled(money(i.amount as never), 2), 0n), 2);
  const customerReturns = fromScaled(custReturns.reduce((a, r) => a + toScaled(returnTotal(r), 2), 0n), 2);
  const supplierReturns = fromScaled(suppReturns.reduce((a, r) => a + toScaled(supplierReturnAmount(r.items), 2), 0n), 2);
  const revenue = fromScaled(toScaled(sum(billings), 2) - toScaled(customerReturns, 2), 2);
  const supplierBills = fromScaled(toScaled(sum(bills), 2) - toScaled(supplierReturns, 2), 2);
  const expenseTotal = sum(expenses);
  const net = fromScaled(toScaled(revenue, 2) - toScaled(supplierBills, 2) - toScaled(expenseTotal, 2), 2);
  // Each listed deal's price is net of its own posted returns (all dates —
  // the deal's current value), so the deal lines tell the same story as
  // the revenue line.
  const dealReturns = orders.length
    ? await db.customerReturn.findMany({
        where: { status: "POSTED", salesOrderId: { in: orders.map((o) => o.id) } },
        select: { salesOrderId: true, credit: { select: { amount: true } }, items: { select: { amount: true } } },
      })
    : [];
  const returnsByOrder = new Map<string, bigint>();
  for (const r of dealReturns) {
    returnsByOrder.set(r.salesOrderId, (returnsByOrder.get(r.salesOrderId) ?? 0n) + toScaled(returnTotal(r), 2));
  }
  return {
    month,
    revenue,
    customerReturns,
    supplierBills,
    supplierReturns,
    expenses: expenseTotal,
    net,
    deals: orders.map((o) => {
      const returns = fromScaled(returnsByOrder.get(o.id) ?? 0n, 2);
      const contractPrice = fromScaled(toScaled(money(o.contractPrice), 2) - toScaled(returns, 2), 2);
      const supplierCost = money(o.supplierCost);
      const { margin, marginPct } = dealMargin(contractPrice, supplierCost);
      return { number: o.number, date: ymd(o.date)!, contractPrice, returns, supplierCost, margin, marginPct };
    }),
  };
}

/** CSV for the profit report: summary rows, then one row per deal. */
export function profitToCsv(report: MonthlyProfit): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const row = (xs: string[]) => xs.map(esc).join(",") + "\n";
  let out = row(["HACIEN monthly profit", report.month]);
  out += row(["Revenue (billings invoiced, less customer returns)", report.revenue]);
  out += row(["Customer returns posted", report.customerReturns]);
  out += row(["Supplier bills recorded (less supplier returns)", report.supplierBills]);
  out += row(["Supplier returns posted", report.supplierReturns]);
  out += row(["Expenses posted", report.expenses]);
  out += row(["Net profit", report.net]);
  out += row([]);
  out += row(["Deal", "Date", "Contract price (net of returns)", "Returns", "Supplier cost", "Margin", "Margin %"]);
  for (const d of report.deals) {
    out += row([d.number, d.date, d.contractPrice, d.returns, d.supplierCost, d.margin, d.marginPct ?? ""]);
  }
  return out;
}
