// S-53: monthly net profit + margin by deal (management view, not a BIR book).
// Definitions, stated on the page:
// - Revenue: posted, non-void billings invoiced in the month.
// - Supplier bills: non-void supplier bills recorded in the month.
// - Expenses: posted expenses dated in the month.
// - Net: revenue − supplier bills − expenses.
// - Margin by deal: sales orders dated in the month (non-void), contract price
//   minus supplier cost; margin % is blank when the contract price is ₱0.
import { db } from "../db";
import { money, ymd } from "../documents/common";
import { fromScaled, toScaled } from "../quotes/calc";
import { manilaToday, isoDate } from "../format";

export type ProfitDeal = {
  number: string;
  date: string;
  contractPrice: string;
  supplierCost: string;
  margin: string;
  marginPct: string | null;
};

export type MonthlyProfit = {
  month: string;
  revenue: string;
  supplierBills: string;
  expenses: string;
  net: string;
  deals: ProfitDeal[];
};

/** Margin for one deal, in money strings. Pure, so it is unit-testable. */
export function dealMargin(contractPrice: string, supplierCost: string): { margin: string; marginPct: string | null } {
  const margin = toScaled(contractPrice, 2) - toScaled(supplierCost, 2);
  const price = toScaled(contractPrice, 2);
  if (price === 0n) return { margin: fromScaled(margin, 2), marginPct: null };
  const pct = Number((margin * 10000n) / price) / 100;
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
  const [billings, bills, expenses, orders] = await Promise.all([
    db.billing.findMany({ where: { status: { not: "VOID" }, invoiceDate: { gte: from, lt: to } }, select: { amount: true } }),
    db.supplierBill.findMany({ where: { status: { not: "VOID" }, billDate: { gte: from, lt: to } }, select: { amount: true } }),
    db.expense.findMany({ where: { status: "POSTED", date: { gte: from, lt: to } }, select: { amount: true } }),
    db.salesOrder.findMany({
      where: { status: { not: "VOID" }, date: { gte: from, lt: to } },
      select: { number: true, date: true, contractPrice: true, supplierCost: true },
      orderBy: [{ date: "asc" }, { number: "asc" }],
    }),
  ]);
  const sum = (xs: readonly { amount: number | string | { toFixed(n: number): string } }[]) => fromScaled(xs.reduce((a, x) => a + toScaled(money(x.amount), 2), 0n), 2);
  const revenue = sum(billings);
  const supplierBills = sum(bills);
  const expenseTotal = sum(expenses);
  const net = fromScaled(toScaled(revenue, 2) - toScaled(supplierBills, 2) - toScaled(expenseTotal, 2), 2);
  return {
    month,
    revenue,
    supplierBills,
    expenses: expenseTotal,
    net,
    deals: orders.map((o) => {
      const contractPrice = money(o.contractPrice);
      const supplierCost = money(o.supplierCost);
      const { margin, marginPct } = dealMargin(contractPrice, supplierCost);
      return { number: o.number, date: ymd(o.date)!, contractPrice, supplierCost, margin, marginPct };
    }),
  };
}

/** CSV for the profit report: summary rows, then one row per deal. */
export function profitToCsv(report: MonthlyProfit): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const row = (xs: string[]) => xs.map(esc).join(",") + "\n";
  let out = row(["HACIEN monthly profit", report.month]);
  out += row(["Revenue (billings invoiced)", report.revenue]);
  out += row(["Supplier bills recorded", report.supplierBills]);
  out += row(["Expenses posted", report.expenses]);
  out += row(["Net profit", report.net]);
  out += row([]);
  out += row(["Deal", "Date", "Contract price", "Supplier cost", "Margin", "Margin %"]);
  for (const d of report.deals) {
    out += row([d.number, d.date, d.contractPrice, d.supplierCost, d.margin, d.marginPct ?? ""]);
  }
  return out;
}
