// Tax worksheet loaders and the manual tax-paid save.
// Behind view_books + BOOKS_ENABLED (callers / layout enforce the flag).
// Never files returns. Customer and supplier data stay on separate worksheets.

import { assertCan, type PermissionUser } from "../permissions";
import { db } from "../db";
import { money, DOC_TX, withTxRetry, DocRuleError } from "../documents/common";
import { writeAudit } from "../audit";
import { fromScaled, toScaled } from "../quotes/calc";
import { manilaYmdFromInstant } from "../books/period";
import { ymdInPeriod } from "../books/period";
import {
  build1701qWorksheet,
  eitherOverThreshold,
  incomeBaseFromTax,
  sumPesos,
  type IncomeTax1701qLines,
} from "../tax/math";
import { TAX_BASIS_UNVERIFIED_NOTE } from "../tax/constants";
import {
  earlierQuarters,
  monthBounds,
  quarterBounds,
  ymdToDate,
  type Quarter,
  type QuarterBounds,
} from "../tax/quarters";
import type { SawtRow, QapRow, SalesMonthRow } from "../tax/csv";

function dateYmd(d: Date): string {
  return manilaYmdFromInstant(d);
}

/** Cumulative non-void billing gross (invoiced) from Jan 1 through quarter end (invoiceDate). */
export async function cumulativeInvoicedTotal(year: number, quarter: Quarter): Promise<string> {
  const b = quarterBounds(year, quarter);
  const agg = await db.billing.aggregate({
    where: {
      status: { not: "VOID" },
      invoiceDate: { gte: ymdToDate(b.yearStartYmd), lte: ymdToDate(b.toYmd) },
    },
    _sum: { amount: true },
  });
  return money(agg._sum.amount ?? 0);
}

/** @deprecated Use cumulativeInvoicedTotal — kept as alias for call sites/tests. */
export const cumulativeGrossSales = cumulativeInvoicedTotal;

/**
 * Cumulative non-void POSTED collections (collected) from Jan 1 through quarter end.
 * Uses collection.amountReceived only — never combined with billings into one basis.
 */
export async function cumulativeCollectedTotal(year: number, quarter: Quarter): Promise<string> {
  const b = quarterBounds(year, quarter);
  const agg = await db.collection.aggregate({
    where: {
      status: "POSTED",
      date: { gte: ymdToDate(b.yearStartYmd), lte: ymdToDate(b.toYmd) },
    },
    _sum: { amountReceived: true },
  });
  return money(agg._sum.amountReceived ?? 0);
}

/** Creditable customer EWT (POSTED collections, amount > 0) from Jan 1 through quarter end. */
export async function creditableWithholdingYtd(year: number, quarter: Quarter): Promise<string> {
  const b = quarterBounds(year, quarter);
  const rows = await db.withholding2307.findMany({
    where: {
      amount: { gt: 0 },
      collection: {
        status: "POSTED",
        date: { gte: ymdToDate(b.yearStartYmd), lte: ymdToDate(b.toYmd) },
      },
    },
    select: { amount: true },
  });
  return sumPesos(rows.map((r) => money(r.amount)));
}

/** Manual tax-paid rows for a year (quarters 1–4). Missing → 0.00. */
export async function listTaxPaidForYear(year: number): Promise<Record<Quarter, string>> {
  const rows = await db.taxPaidQuarter.findMany({ where: { year } });
  const out: Record<Quarter, string> = { 1: "0.00", 2: "0.00", 3: "0.00", 4: "0.00" };
  for (const r of rows) {
    if (r.quarter >= 1 && r.quarter <= 4) out[r.quarter as Quarter] = money(r.amountPaid);
  }
  return out;
}

/** Sum of tax paid entered for quarters before `quarter` in the same year. */
export async function taxPaidEarlierQuarters(year: number, quarter: Quarter): Promise<string> {
  const paid = await listTaxPaidForYear(year);
  return sumPesos(earlierQuarters(quarter).map((q) => paid[q]));
}

export type IncomeTaxWorksheet = {
  bounds: QuarterBounds;
  /** Non-void billings Jan 1 → quarter end (invoiceDate). Not a chosen basis. */
  invoicedTotal: string;
  /** Non-void POSTED collections Jan 1 → quarter end (date). Not a chosen basis. */
  collectedTotal: string;
  /** Line-by-line math if the accountant uses the invoiced figure. */
  invoiced: IncomeTax1701qLines;
  /** Line-by-line math if the accountant uses the collected figure. */
  collected: IncomeTax1701qLines;
  /** True when either cumulative figure exceeds ₱3M. */
  overThreshold: boolean;
  /** Staff-facing note — app does not pick invoiced vs collected. */
  basisNote: string;
  /** Per-quarter manual tax-paid amounts for the year (for the entry form). */
  taxPaidByQuarter: Record<Quarter, string>;
  /** This quarter's own manual tax-paid entry (not used in line e until later quarters). */
  thisQuarterTaxPaid: string;
};

export async function getIncomeTaxWorksheet(
  actor: PermissionUser,
  year: number,
  quarter: Quarter,
): Promise<IncomeTaxWorksheet> {
  assertCan(actor, "view_books");
  const bounds = quarterBounds(year, quarter);
  const [invoicedTotal, collectedTotal, e, f, taxPaidByQuarter] = await Promise.all([
    cumulativeInvoicedTotal(year, quarter),
    cumulativeCollectedTotal(year, quarter),
    taxPaidEarlierQuarters(year, quarter),
    creditableWithholdingYtd(year, quarter),
    listTaxPaidForYear(year),
  ]);
  const shared = { taxPaidEarlierQuarters: e, creditableWithholding: f };
  const invoiced = build1701qWorksheet({ cumulativeGrossSales: invoicedTotal, ...shared });
  const collected = build1701qWorksheet({ cumulativeGrossSales: collectedTotal, ...shared });
  return {
    bounds,
    invoicedTotal,
    collectedTotal,
    invoiced,
    collected,
    overThreshold: eitherOverThreshold(invoicedTotal, collectedTotal),
    basisNote: TAX_BASIS_UNVERIFIED_NOTE,
    taxPaidByQuarter,
    thisQuarterTaxPaid: taxPaidByQuarter[quarter],
  };
}

/** Upsert the manual tax-paid amount for one quarter; writes an audit log. */
export async function saveTaxPaidQuarter(
  input: { year: number; quarter: Quarter; amountPaid: string; notes?: string | null },
  actor: PermissionUser & { id: string },
): Promise<{ id: string; amountPaid: string }> {
  assertCan(actor, "view_books");
  let amount: string;
  try {
    amount = fromScaled(toScaled(input.amountPaid, 2), 2);
  } catch {
    throw new DocRuleError("Enter a valid peso amount for tax paid.", "amountPaid");
  }
  if (toScaled(amount, 2) < 0n) {
    throw new DocRuleError("Tax paid cannot be negative.", "amountPaid");
  }

  return withTxRetry(async () =>
    db.$transaction(async (tx) => {
      const existing = await tx.taxPaidQuarter.findUnique({
        where: { year_quarter: { year: input.year, quarter: input.quarter } },
      });
      const row = existing
        ? await tx.taxPaidQuarter.update({
            where: { id: existing.id },
            data: {
              amountPaid: amount,
              notes: input.notes?.trim() || null,
              updatedById: actor.id,
            },
          })
        : await tx.taxPaidQuarter.create({
            data: {
              year: input.year,
              quarter: input.quarter,
              amountPaid: amount,
              notes: input.notes?.trim() || null,
              updatedById: actor.id,
            },
          });

      await writeAudit(tx, {
        userId: actor.id,
        entityType: "TaxPaidQuarter",
        entityId: row.id,
        action: existing ? "update" : "create",
        before: existing
          ? {
              year: existing.year,
              quarter: existing.quarter,
              amountPaid: money(existing.amountPaid),
              notes: existing.notes,
            }
          : null,
        after: {
          year: row.year,
          quarter: row.quarter,
          amountPaid: money(row.amountPaid),
          notes: row.notes,
        },
      });

      return { id: row.id, amountPaid: money(row.amountPaid) };
    }, DOC_TX),
  );
}

export type Customer2307WorksheetRow = SawtRow & {
  id: string;
  customerId: string;
  collectionId: string | null;
  collectionNumber: string | null;
  collectionDate: string | null;
  rate: string;
  href: string;
};

export type Customer2307Worksheet = {
  bounds: QuarterBounds;
  rows: Customer2307WorksheetRow[];
  totalIncome: string;
  totalTax: string;
  pendingCount: number;
  receivedCount: number;
};

/** Customer 2307s whose collection date falls in the quarter (POSTED, amount > 0). */
export async function getCustomer2307Worksheet(
  actor: PermissionUser,
  year: number,
  quarter: Quarter,
): Promise<Customer2307Worksheet> {
  assertCan(actor, "view_books");
  const bounds = quarterBounds(year, quarter);
  const rows = await db.withholding2307.findMany({
    where: {
      amount: { gt: 0 },
      collection: {
        status: "POSTED",
        date: { gte: ymdToDate(bounds.fromYmd), lte: ymdToDate(bounds.toYmd) },
      },
    },
    include: {
      customer: { select: { id: true, name: true, tin: true } },
      collection: { select: { id: true, number: true, date: true } },
    },
    orderBy: [{ createdAt: "asc" }],
  });

  const mapped: Customer2307WorksheetRow[] = rows.map((w) => {
    const tax = money(w.amount);
    const rate = Number(w.rate).toFixed(4);
    const incomeAmount = incomeBaseFromTax(tax, rate);
    const status = w.status === "RECEIVED" ? "Received" : "Pending";
    return {
      id: w.id,
      customerId: w.customer.id,
      tin: w.customer.tin ?? "",
      name: w.customer.name,
      atc: w.atcCode ?? "",
      incomeAmount,
      taxWithheld: tax,
      status,
      collectionId: w.collection?.id ?? null,
      collectionNumber: w.collection?.number ?? null,
      collectionDate: w.collection ? dateYmd(w.collection.date) : null,
      rate,
      href: w.collection ? `/billing/collections/${w.collection.id}` : `/billing/2307`,
    };
  });

  return {
    bounds,
    rows: mapped,
    totalIncome: sumPesos(mapped.map((r) => r.incomeAmount)),
    totalTax: sumPesos(mapped.map((r) => r.taxWithheld)),
    pendingCount: mapped.filter((r) => r.status === "Pending").length,
    receivedCount: mapped.filter((r) => r.status === "Received").length,
  };
}

export type SupplierEwtWorksheetRow = QapRow & {
  id: string;
  paymentId: string;
  paymentNumber: string;
  paymentDate: string;
  supplierId: string;
  href: string;
};

export type SupplierEwtWorksheet = {
  year: number;
  quarter: Quarter | null;
  bounds: QuarterBounds | null;
  rows: SupplierEwtWorksheetRow[];
  monthlyTotals: { month: number; label: string; tax: string; base: string; count: number }[];
  quarterlyTotals: { quarter: Quarter; label: string; tax: string; base: string; count: number }[];
  totalTax: string;
  totalBase: string;
};

/**
 * Supplier EWT from posted payment allocations (withholdingApplied > 0).
 * When `quarter` is set, filter to that quarter; otherwise the whole year.
 */
export async function getSupplierEwtWorksheet(
  actor: PermissionUser,
  year: number,
  quarter: Quarter | null = null,
): Promise<SupplierEwtWorksheet> {
  assertCan(actor, "view_books");
  const fromYmd = `${year}-01-01`;
  const toYmd = quarter ? quarterBounds(year, quarter).toYmd : `${year}-12-31`;
  const fromFilter = quarter ? quarterBounds(year, quarter).fromYmd : fromYmd;

  const payments = await db.supplierPayment.findMany({
    where: {
      status: "POSTED",
      date: { gte: ymdToDate(fromFilter), lte: ymdToDate(toYmd) },
    },
    include: {
      supplier: { select: { id: true, name: true, tin: true } },
      allocations: {
        where: { withholdingApplied: { gt: 0 } },
        select: {
          id: true,
          withholdingApplied: true,
          withholdingRate: true,
          atcCode: true,
        },
      },
    },
    orderBy: [{ date: "asc" }, { number: "asc" }],
  });

  const rows: SupplierEwtWorksheetRow[] = [];
  for (const p of payments) {
    const payDate = dateYmd(p.date);
    if (!ymdInPeriod(payDate, fromFilter, toYmd)) continue;
    for (const a of p.allocations) {
      const tax = money(a.withholdingApplied);
      if (toScaled(tax, 2) <= 0n) continue;
      const rate = Number(a.withholdingRate).toFixed(4);
      const base = incomeBaseFromTax(tax, rate);
      rows.push({
        id: a.id,
        tin: p.supplier.tin ?? "",
        name: p.supplier.name,
        atc: a.atcCode ?? "",
        base,
        rate,
        tax,
        month: payDate.slice(0, 7),
        paymentId: p.id,
        paymentNumber: p.number,
        paymentDate: payDate,
        supplierId: p.supplier.id,
        href: `/payables/payments/${p.id}`,
      });
    }
  }

  const monthlyTotals = [];
  for (let m = 1; m <= 12; m++) {
    const mb = monthBounds(year, m);
    const inMonth = rows.filter((r) => ymdInPeriod(r.paymentDate, mb.fromYmd, mb.toYmd));
    if (quarter) {
      const qb = quarterBounds(year, quarter);
      if (!ymdInPeriod(mb.fromYmd, qb.fromYmd, qb.toYmd)) continue;
    }
    monthlyTotals.push({
      month: m,
      label: mb.fromYmd.slice(0, 7),
      tax: sumPesos(inMonth.map((r) => r.tax)),
      base: sumPesos(inMonth.map((r) => r.base)),
      count: inMonth.length,
    });
  }

  const quarterlyTotals: SupplierEwtWorksheet["quarterlyTotals"] = ([1, 2, 3, 4] as Quarter[]).map((q) => {
    const qb = quarterBounds(year, q);
    const inQ = rows.filter((r) => ymdInPeriod(r.paymentDate, qb.fromYmd, qb.toYmd));
    return {
      quarter: q,
      label: qb.label,
      tax: sumPesos(inQ.map((r) => r.tax)),
      base: sumPesos(inQ.map((r) => r.base)),
      count: inQ.length,
    };
  });

  return {
    year,
    quarter,
    bounds: quarter ? quarterBounds(year, quarter) : null,
    rows,
    monthlyTotals,
    quarterlyTotals,
    totalTax: sumPesos(rows.map((r) => r.tax)),
    totalBase: sumPesos(rows.map((r) => r.base)),
  };
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export type SalesSummaryWorksheet = {
  year: number;
  months: (SalesMonthRow & { href: string; fromYmd: string; toYmd: string })[];
  yearTotal: string;
  billingCount: number;
};

/** Non-void billings by invoiceDate, grouped by Manila month. */
export async function getSalesSummaryWorksheet(
  actor: PermissionUser,
  year: number,
): Promise<SalesSummaryWorksheet> {
  assertCan(actor, "view_books");
  const fromYmd = `${year}-01-01`;
  const toYmd = `${year}-12-31`;
  const billings = await db.billing.findMany({
    where: {
      status: { not: "VOID" },
      invoiceDate: { gte: ymdToDate(fromYmd), lte: ymdToDate(toYmd) },
    },
    select: { id: true, amount: true, invoiceDate: true },
    orderBy: [{ invoiceDate: "asc" }],
  });

  const months = [];
  for (let m = 1; m <= 12; m++) {
    const mb = monthBounds(year, m);
    const inMonth = billings.filter((b) => ymdInPeriod(dateYmd(b.invoiceDate), mb.fromYmd, mb.toYmd));
    const gross = sumPesos(inMonth.map((b) => money(b.amount)));
    months.push({
      month: mb.fromYmd.slice(0, 7),
      label: MONTH_NAMES[m - 1]!,
      grossSales: gross,
      billingCount: inMonth.length,
      fromYmd: mb.fromYmd,
      toYmd: mb.toYmd,
      href: `/books/sales?from=${mb.fromYmd}&to=${mb.toYmd}`,
    });
  }

  return {
    year,
    months,
    yearTotal: sumPesos(months.map((m) => m.grossSales)),
    billingCount: billings.length,
  };
}
