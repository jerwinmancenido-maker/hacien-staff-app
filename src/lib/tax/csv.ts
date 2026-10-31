// CSV exporters for tax worksheets. Column orders are labelled UNVERIFIED —
// not official BIR SAWT / QAP files. Confirm with accountant before upload.
//
// Formula injection: every data cell goes through Books `csvCell`. Plain numbers
// like -500.00 are NOT escaped; =/+/@/tab/CR and non-numeric leading "-" are.

import { csvCell } from "../books/csv";
import {
  QAP_CSV_FORMAT_LABEL,
  SAWT_CSV_FORMAT_LABEL,
  TAX_BASIS_UNVERIFIED_NOTE,
  TAX_WORKSHEET_BANNER,
} from "./constants";

function csvRow(cells: readonly (string | number)[]): string {
  return cells.map((c) => csvCell(String(c))).join(",");
}

export type SawtRow = {
  tin: string;
  name: string;
  atc: string;
  incomeAmount: string;
  taxWithheld: string;
  status: string;
};

/**
 * SAWT-style column order (UNVERIFIED):
 * Seq, TIN, Payee Name, ATC, Tax Base / Income, Tax Rate (blank), Tax Withheld, 2307 Status
 */
export function customer2307ToSawtCsv(
  rows: readonly SawtRow[],
  meta: { year: number; quarter: number; rateHint?: string },
): string {
  const lines: string[] = [
    `# ${TAX_WORKSHEET_BANNER}`,
    `# Format: SAWT-style · ${SAWT_CSV_FORMAT_LABEL}`,
    `# Period: Q${meta.quarter} ${meta.year}`,
    csvRow(["Seq", "TIN", "Payee Name", "ATC", "Income Amount", "Tax Rate", "Tax Withheld", "2307 Status"]),
  ];
  rows.forEach((r, i) => {
    lines.push(
      csvRow([
        i + 1,
        r.tin || "",
        r.name,
        r.atc || "",
        r.incomeAmount,
        meta.rateHint ?? "",
        r.taxWithheld,
        r.status,
      ]),
    );
  });
  return lines.join("\n") + "\n";
}

export type QapRow = {
  tin: string;
  name: string;
  atc: string;
  base: string;
  rate: string;
  tax: string;
  month: string;
};

/**
 * QAP-style column order (UNVERIFIED):
 * Seq, TIN, Payee Name, ATC, Tax Base, Tax Rate, Tax Withheld, Month
 */
export function supplierEwtToQapCsv(
  rows: readonly QapRow[],
  meta: { year: number; quarter?: number },
): string {
  const period =
    meta.quarter != null ? `Q${meta.quarter} ${meta.year}` : `Year ${meta.year}`;
  const lines: string[] = [
    `# ${TAX_WORKSHEET_BANNER}`,
    `# Format: QAP-style · ${QAP_CSV_FORMAT_LABEL}`,
    `# Period: ${period}`,
    `# Note: Only applies if HACIEN is registered to withhold — confirm with RDO.`,
    csvRow(["Seq", "TIN", "Payee Name", "ATC", "Tax Base", "Tax Rate", "Tax Withheld", "Month"]),
  ];
  rows.forEach((r, i) => {
    lines.push(csvRow([i + 1, r.tin || "", r.name, r.atc || "", r.base, r.rate, r.tax, r.month]));
  });
  return lines.join("\n") + "\n";
}

export type SalesMonthRow = {
  month: string;
  label: string;
  grossSales: string;
  billingCount: number;
};

/** Simple monthly sales CSV for the year. */
export function salesSummaryToCsv(rows: readonly SalesMonthRow[], year: number): string {
  const lines: string[] = [
    `# ${TAX_WORKSHEET_BANNER}`,
    `# Sales summary by month · ${year}`,
    csvRow(["Month", "Label", "Gross Sales", "Billing Count"]),
  ];
  for (const r of rows) {
    lines.push(csvRow([r.month, r.label, r.grossSales, r.billingCount]));
  }
  return lines.join("\n") + "\n";
}

/** 1701Q worksheet — both invoiced and collected columns; no single basis chosen. */
export function incomeTaxWorksheetToCsv(
  sheet: {
    invoicedTotal: string;
    collectedTotal: string;
    invoiced: { a: string; b: string; c: string; d: string; e: string; f: string; g: string };
    collected: { a: string; b: string; c: string; d: string; e: string; f: string; g: string };
  },
  meta: { year: number; quarter: number; label: string },
): string {
  return (
    [
      `# ${TAX_WORKSHEET_BANNER}`,
      `# ${meta.label}`,
      `# ${TAX_BASIS_UNVERIFIED_NOTE}`,
      csvRow(["Line", "Description", "If invoiced", "If collected"]),
      csvRow(["a", "Invoiced total / Collected total (Jan 1 to quarter end)", sheet.invoicedTotal, sheet.collectedTotal]),
      csvRow(["b", "Less allowance (8% option, sole proprietor — confirm)", sheet.invoiced.b, sheet.collected.b]),
      csvRow(["c", "Taxable (max 0, a−b)", sheet.invoiced.c, sheet.collected.c]),
      csvRow(["d", "Tax (c × 8%)", sheet.invoiced.d, sheet.collected.d]),
      csvRow(["e", "Less tax paid in earlier quarters", sheet.invoiced.e, sheet.collected.e]),
      csvRow(["f", "Less creditable withholding (customer 2307s)", sheet.invoiced.f, sheet.collected.f]),
      csvRow(["g", "Payable or overpayment (d − e − f)", sheet.invoiced.g, sheet.collected.g]),
    ].join("\n") + "\n"
  );
}
