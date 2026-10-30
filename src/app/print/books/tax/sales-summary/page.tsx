import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { isBooksEnabled } from "@/lib/books/features";
import { TAX_WORKSHEET_BANNER, TAX_WORKSHEET_DISCLAIMER, TAX_WORKSHEET_PAGES } from "@/lib/tax/constants";
import { latestFinishedQuarter } from "@/lib/tax/quarters";
import { getSalesSummaryWorksheet } from "@/lib/services/tax-worksheets";
import { getSettingsSnapshot } from "@/lib/settings";
import { formatPeso } from "@/lib/format";
import { PrintButton } from "@/components/docs/PrintButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: TAX_WORKSHEET_PAGES.salesSummary.title };

export default async function PrintSalesSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const user = await requirePagePermission("view_books");
  if (!(await isBooksEnabled())) notFound();
  const sp = await searchParams;
  const yearNum = sp.year ? Number(sp.year) : latestFinishedQuarter().year;
  const year = Number.isInteger(yearNum) && yearNum >= 2000 && yearNum <= 2100 ? yearNum : latestFinishedQuarter().year;
  const sheet = await getSalesSummaryWorksheet(user, year);
  const { settings } = await getSettingsSnapshot();
  const company = settings.company;

  return (
    <div className="print-shell">
      <div className="print-toolbar no-print">
        <Link className="btn btn-secondary" href={`/books/tax/sales-summary?year=${year}`}>
          Back to worksheet
        </Link>
        <PrintButton />
      </div>
      <div className="alert warn no-print" role="status">
        <b>{TAX_WORKSHEET_BANNER}</b>
      </div>
      <article className="print-doc books-register-doc">
        <header className="print-header books-register-head">
          <div>
            <div className="print-brand">{company.name || "HACIEN"}</div>
            <div className="small">NON-VAT · TIN {company.tin || "—"}</div>
          </div>
          <div className="print-doc-title">
            <h1>{TAX_WORKSHEET_PAGES.salesSummary.title}</h1>
            <div className="small muted">{TAX_WORKSHEET_DISCLAIMER}</div>
            <div className="small">Year {year}</div>
            <div className="small books-draft-stamp">{TAX_WORKSHEET_BANNER}</div>
          </div>
        </header>
        <table className="books-register-table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Gross sales</th>
              <th className="num">Billings</th>
            </tr>
          </thead>
          <tbody>
            {sheet.months.map((m) => (
              <tr key={m.month}>
                <td>{m.label}</td>
                <td className="num">{formatPeso(m.grossSales)}</td>
                <td className="num">{m.billingCount}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>
                <b>Year total</b>
              </td>
              <td className="num">
                <b>{formatPeso(sheet.yearTotal)}</b>
              </td>
              <td className="num">
                <b>{sheet.billingCount}</b>
              </td>
            </tr>
          </tfoot>
        </table>
      </article>
    </div>
  );
}
