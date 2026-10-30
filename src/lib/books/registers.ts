// Pure register builders: filter voids, sort by date, running page totals,
// period totals, CSV. Scaled-decimal (BigInt centavos) only — never floats.

import { fromScaled, toScaled } from "../quotes/calc";
import { ymdCmp } from "../cash/balance";
import type { RegisterColumn, RegisterConfig, RegisterSourceKind } from "./config";
import { ymdInPeriod } from "./period";

export type BookSourceRow = {
  id: string;
  kind: RegisterSourceKind;
  /** Manila calendar YYYY-MM-DD. */
  date: string;
  documentNumber: string;
  party: string;
  particulars: string;
  /** Absolute amount, 2-decimal string. */
  amount: string;
  /** EWT amount when present; null when not applicable for the row. */
  ewt: string | null;
  /** Source document URL; null when the target section is gated off (e.g. Cash). */
  href: string | null;
  /** Voided rows are excluded before totals. */
  voided?: boolean;
};

export type BookRegisterRow = BookSourceRow & {
  /** Running total of amounts on the current print page (after this row). */
  pageAmountTotal: string;
  /** Running total of EWT on the current print page (after this row). */
  pageEwtTotal: string;
  pageIndex: number;
  rowOnPage: number;
};

export type BookPageTotal = {
  pageIndex: number;
  amountTotal: string;
  ewtTotal: string;
  rowCount: number;
};

/** Sales register only — never combine invoiced + collected into one tax-like total. */
export type SalesPeriodTotals = {
  invoicedAmount: string;
  invoicedEwt: string;
  collectedAmount: string;
  collectedEwt: string;
};

export type BookRegister = {
  rows: BookRegisterRow[];
  pageTotals: BookPageTotal[];
  /**
   * Single period total for registers that are not the sales register.
   * Null on the sales register (use salesPeriodTotals instead).
   */
  periodAmountTotal: string | null;
  periodEwtTotal: string | null;
  /** Present only for the sales register. */
  salesPeriodTotals: SalesPeriodTotals | null;
  rowCount: number;
};

export const SOURCE_LABELS: Record<RegisterSourceKind, string> = {
  BILLING: "Billing",
  COLLECTION: "Collection",
  SUPPLIER_BILL: "Supplier bill",
  SUPPLIER_PAYMENT: "Supplier payment",
  EXPENSE: "Expense",
};

export const INVOICED_TOTAL_LABEL = "Invoiced total";
export const COLLECTED_TOTAL_LABEL = "Collected total";

/** Sum amounts with scaled decimals. */
export function sumMoney(amounts: readonly string[]): string {
  let total = 0n;
  for (const a of amounts) total += toScaled(a || "0", 2);
  return fromScaled(total, 2);
}

/**
 * Build a register for a period. Excludes voided rows. Sorts by date then
 * document number. Computes running page totals and period totals.
 * Sales register: separate Invoiced / Collected period totals (no combined total).
 */
export function buildRegister(
  config: RegisterConfig,
  sources: readonly BookSourceRow[],
  fromYmd: string,
  toYmd: string,
): BookRegister {
  const allowed = new Set(config.sources);
  const filtered = sources
    .filter((r) => !r.voided && allowed.has(r.kind) && ymdInPeriod(r.date, fromYmd, toYmd))
    .slice()
    .sort((a, b) => {
      const c = ymdCmp(a.date, b.date);
      if (c !== 0) return c;
      const k = a.kind.localeCompare(b.kind);
      if (k !== 0) return k;
      return a.documentNumber.localeCompare(b.documentNumber);
    });

  const rowsPerPage = Math.max(1, config.rowsPerPage);
  const rows: BookRegisterRow[] = [];
  const pageTotals: BookPageTotal[] = [];
  let periodAmt = 0n;
  let periodEwt = 0n;
  let invoicedAmt = 0n;
  let invoicedEwt = 0n;
  let collectedAmt = 0n;
  let collectedEwt = 0n;
  let pageAmt = 0n;
  let pageEwt = 0n;
  let pageIndex = 0;
  let rowOnPage = 0;
  const isSales = config.key === "sales";

  const flushPage = () => {
    if (rowOnPage === 0) return;
    pageTotals.push({
      pageIndex,
      amountTotal: fromScaled(pageAmt, 2),
      ewtTotal: fromScaled(pageEwt, 2),
      rowCount: rowOnPage,
    });
    pageAmt = 0n;
    pageEwt = 0n;
    rowOnPage = 0;
    pageIndex += 1;
  };

  for (const src of filtered) {
    if (rowOnPage >= rowsPerPage) flushPage();
    const amt = toScaled(src.amount || "0", 2);
    const ewt = src.ewt != null && src.ewt !== "" ? toScaled(src.ewt, 2) : 0n;
    pageAmt += amt;
    pageEwt += ewt;
    periodAmt += amt;
    periodEwt += ewt;
    if (src.kind === "BILLING") {
      invoicedAmt += amt;
      invoicedEwt += ewt;
    } else if (src.kind === "COLLECTION") {
      collectedAmt += amt;
      collectedEwt += ewt;
    }
    rowOnPage += 1;
    rows.push({
      ...src,
      pageAmountTotal: fromScaled(pageAmt, 2),
      pageEwtTotal: fromScaled(pageEwt, 2),
      pageIndex,
      rowOnPage,
    });
  }
  flushPage();

  return {
    rows,
    pageTotals,
    periodAmountTotal: isSales ? null : fromScaled(periodAmt, 2),
    periodEwtTotal: isSales ? null : fromScaled(periodEwt, 2),
    salesPeriodTotals: isSales
      ? {
          invoicedAmount: fromScaled(invoicedAmt, 2),
          invoicedEwt: fromScaled(invoicedEwt, 2),
          collectedAmount: fromScaled(collectedAmt, 2),
          collectedEwt: fromScaled(collectedEwt, 2),
        }
      : null,
    rowCount: rows.length,
  };
}

/**
 * CSV cell escape. Neutralizes spreadsheet formula injection by prefixing a
 * leading apostrophe when the value starts with = + @ tab CR, or a leading
 * minus that is *not* a plain number, then applies normal RFC-style quoting
 * for comma / quote / newline.
 * Shared by Books registers and tax worksheets (single helper — do not duplicate).
 *
 * Plain numeric cells matching /^-?\d+(\.\d+)?$/ (including negatives like
 * "-500.00") stay unescaped so spreadsheet apps keep them as numbers.
 * Risky minus forms ("-cmd", "-1+1") still get the apostrophe.
 */
export function csvCell(v: string): string {
  let out = String(v);
  const plainNumber = /^-?\d+(\.\d+)?$/.test(out);
  if (/^[=+@\t\r]/.test(out) || (/^-/.test(out) && !plainNumber)) {
    out = `'${out}`;
  }
  if (/[",\n]/.test(out)) return `"${out.replace(/"/g, '""')}"`;
  return out;
}

function cellValue(row: BookSourceRow, key: RegisterColumn["key"]): string {
  switch (key) {
    case "date":
      return row.date;
    case "documentNumber":
      return row.documentNumber;
    case "party":
      return row.party;
    case "particulars":
      return row.particulars;
    case "amount":
      return row.amount;
    case "ewt":
      return row.ewt ?? "";
    case "source":
      return SOURCE_LABELS[row.kind];
  }
}

function totalCsvLine(
  config: RegisterConfig,
  label: string,
  amount: string,
  ewt: string,
): string {
  return config.columns
    .map((c) => {
      if (c.key === "particulars") return csvCell(label);
      if (c.key === "amount") return csvCell(amount);
      if (c.key === "ewt") return csvCell(ewt);
      return "";
    })
    .join(",");
}

/** CSV for a built register (config columns + period total row(s)). */
export function registerToCsv(config: RegisterConfig, register: BookRegister): string {
  const headers = config.columns.map((c) => c.label);
  const lines = [headers.map(csvCell).join(",")];
  for (const row of register.rows) {
    lines.push(config.columns.map((c) => csvCell(cellValue(row, c.key))).join(","));
  }
  if (register.salesPeriodTotals) {
    const s = register.salesPeriodTotals;
    lines.push(totalCsvLine(config, INVOICED_TOTAL_LABEL, s.invoicedAmount, s.invoicedEwt));
    lines.push(totalCsvLine(config, COLLECTED_TOTAL_LABEL, s.collectedAmount, s.collectedEwt));
  } else if (register.periodAmountTotal != null) {
    lines.push(
      totalCsvLine(config, "Period total", register.periodAmountTotal, register.periodEwtTotal ?? "0.00"),
    );
  }
  return `${lines.join("\n")}\n`;
}

/** True when any column key looks like VAT (guard for non-VAT HACIEN). */
export function registerHasVatColumn(config: RegisterConfig): boolean {
  return config.columns.some((c) => /vat|input.?tax|output.?tax/i.test(c.key) || /vat|input.?tax|output.?tax/i.test(c.label));
}
