import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { isBooksEnabled } from "@/lib/books/features";
import {
  ALLOWANCE_8PCT_LABEL,
  COLLECTED_TOTAL_LABEL,
  INCOME_TAX_LINE_HINTS,
  INVOICED_TOTAL_LABEL,
  OVER_THRESHOLD_WARNING,
  TAX_BASIS_UNVERIFIED_NOTE,
  TAX_WORKSHEET_BANNER,
  TAX_WORKSHEET_DISCLAIMER,
  TAX_WORKSHEET_PAGES,
} from "@/lib/tax/constants";
import { parseTaxQuarter } from "@/lib/tax/quarters";
import { getIncomeTaxWorksheet } from "@/lib/services/tax-worksheets";
import { getSettingsSnapshot } from "@/lib/settings";
import { formatPeso } from "@/lib/format";
import { PrintButton } from "@/components/docs/PrintButton";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: TAX_WORKSHEET_PAGES.income.title };

export default async function PrintIncomeTaxPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; quarter?: string }>;
}) {
  const user = await requirePagePermission("view_books");
  if (!(await isBooksEnabled())) notFound();
  const sp = await searchParams;
  const period = parseTaxQuarter(sp.year, sp.quarter);
  const sheet = await getIncomeTaxWorksheet(user, period.year, period.quarter);
  const { settings } = await getSettingsSnapshot();
  const company = settings.company;
  const q = `year=${period.year}&quarter=${period.quarter}`;
  const rows: { letter: string; label: string; hint: string; invoiced: string; collected: string }[] = [
    {
      letter: "a",
      label: "Cumulative from Jan 1 to quarter end",
      hint: INCOME_TAX_LINE_HINTS.a,
      invoiced: sheet.invoicedTotal,
      collected: sheet.collectedTotal,
    },
    {
      letter: "b",
      label: `Less allowance — ${ALLOWANCE_8PCT_LABEL}`,
      hint: INCOME_TAX_LINE_HINTS.b,
      invoiced: sheet.invoiced.b,
      collected: sheet.collected.b,
    },
    { letter: "c", label: "Taxable amount", hint: INCOME_TAX_LINE_HINTS.c, invoiced: sheet.invoiced.c, collected: sheet.collected.c },
    { letter: "d", label: "Income tax (8%)", hint: INCOME_TAX_LINE_HINTS.d, invoiced: sheet.invoiced.d, collected: sheet.collected.d },
    {
      letter: "e",
      label: "Less tax paid in earlier quarters",
      hint: INCOME_TAX_LINE_HINTS.e,
      invoiced: sheet.invoiced.e,
      collected: sheet.collected.e,
    },
    {
      letter: "f",
      label: "Less creditable withholding (customer 2307s)",
      hint: INCOME_TAX_LINE_HINTS.f,
      invoiced: sheet.invoiced.f,
      collected: sheet.collected.f,
    },
    {
      letter: "g",
      label: "Payable or overpayment",
      hint: INCOME_TAX_LINE_HINTS.g,
      invoiced: sheet.invoiced.g,
      collected: sheet.collected.g,
    },
  ];

  return (
    <div className="print-shell">
      <div className="print-toolbar no-print">
        <Link className="btn btn-secondary" href={`/books/tax/income?${q}`}>
          Back to worksheet
        </Link>
        <span className="small muted">A4 · {TAX_WORKSHEET_PAGES.income.title}</span>
        <PrintButton />
      </div>
      <div className="alert warn print-toolbar-alert no-print" role="status">
        <b>{TAX_WORKSHEET_BANNER}</b>
      </div>

      <article className="print-doc books-register-doc">
        <header className="print-header books-register-head">
          <div>
            <div className="print-brand">{company.name || "HACIEN"}</div>
            <div className="small">NON-VAT · 8% income tax option · TIN {company.tin || "—"}</div>
            <div className="small" style={{ whiteSpace: "pre-wrap" }}>
              {company.address || "—"}
            </div>
          </div>
          <div className="print-doc-title">
            <h1>{TAX_WORKSHEET_PAGES.income.title}</h1>
            <div className="small muted">{TAX_WORKSHEET_DISCLAIMER}</div>
            <div className="small">Period: {sheet.bounds.label}</div>
            <div className="small books-draft-stamp">{TAX_WORKSHEET_BANNER}</div>
          </div>
        </header>

        <p>
          <b>{TAX_BASIS_UNVERIFIED_NOTE}</b>
        </p>

        {sheet.overThreshold ? (
          <p className="error">
            <b>{OVER_THRESHOLD_WARNING}</b>
          </p>
        ) : null}

        <table className="books-register-table">
          <thead>
            <tr>
              <th></th>
              <th>Line</th>
              <th className="num">{INVOICED_TOTAL_LABEL}</th>
              <th className="num">{COLLECTED_TOTAL_LABEL}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.letter}>
                <td>
                  <b>({r.letter})</b>
                </td>
                <td>
                  <div>{r.label}</div>
                  <div className="small muted">{r.hint}</div>
                </td>
                <td className="num">{formatPeso(r.invoiced)}</td>
                <td className="num">{formatPeso(r.collected)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </div>
  );
}
