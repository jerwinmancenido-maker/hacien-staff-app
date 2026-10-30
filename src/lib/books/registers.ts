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

export type BookRegister = {
  rows: BookRegisterRow[];
  pageTotals: BookPageTotal[];
  periodAmountTotal: string;
  periodEwtTotal: string;
  rowCount: number;
};

export const SOURCE_LABELS: Record<RegisterSourceKind, string> = {
  BILLING: "Billing",
  COLLECTION: "Collection",
  SUPPLIER_BILL: "Supplier bill",
  SUPPLIER_PAYMENT: "Supplier payment",
  EXPENSE: "Expense",
};

/** Sum amounts with scaled decimals. */
export function sumMoney(amounts: readonly string[]): string {
  let total = 0n;
  for (const a of amounts) total += toScaled(a || "0", 2);
  return fromScaled(total, 2);
}

/**
 * Build a register for a period. Excludes voided rows. Sorts by date then
 * document number. Computes running page totals and period totals.
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
  let pageAmt = 0n;
  let pageEwt = 0n;
  let pageIndex = 0;
  let rowOnPage = 0;

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
    periodAmountTotal: fromScaled(periodAmt, 2),
    periodEwtTotal: fromScaled(periodEwt, 2),
    rowCount: rows.length,
  };
}

function csvCell(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
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

/** CSV for a built register (config columns + period total row). */
export function registerToCsv(config: RegisterConfig, register: BookRegister): string {
  const headers = config.columns.map((c) => c.label);
  const lines = [headers.map(csvCell).join(",")];
  for (const row of register.rows) {
    lines.push(config.columns.map((c) => csvCell(cellValue(row, c.key))).join(","));
  }
  // Period total line
  const totalCells = config.columns.map((c) => {
    if (c.key === "particulars") return csvCell("Period total");
    if (c.key === "amount") return csvCell(register.periodAmountTotal);
    if (c.key === "ewt") return csvCell(register.periodEwtTotal);
    return "";
  });
  lines.push(totalCells.join(","));
  return `${lines.join("\n")}\n`;
}

/** True when any column key looks like VAT (guard for non-VAT HACIEN). */
export function registerHasVatColumn(config: RegisterConfig): boolean {
  return config.columns.some((c) => /vat|input.?tax|output.?tax/i.test(c.key) || /vat|input.?tax|output.?tax/i.test(c.label));
}
