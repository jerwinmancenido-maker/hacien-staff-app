import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { taxWorksheetDisclaimer, TAX_WORKSHEET_PAGES } from "@/lib/tax/constants";
import { getSettingsSnapshot } from "@/lib/settings";
import { latestFinishedQuarter } from "@/lib/tax/quarters";
import { getSalesSummaryWorksheet } from "@/lib/services/tax-worksheets";
import { formatPeso } from "@/lib/format";
import { BooksNav } from "@/components/books/BooksNav";
import { TaxNav } from "@/components/books/TaxNav";
import { TaxQuarterFilters } from "@/components/books/TaxQuarterFilters";
import { TaxWorksheetBanner } from "@/components/books/TaxWorksheetBanner";
import { EmptyState, PageHeader } from "@/components/ui";

export default async function SalesSummaryWorksheetPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const user = await requirePagePermission("view_books");
  const { settings } = await getSettingsSnapshot();
  const sp = await searchParams;
  const finished = latestFinishedQuarter();
  const yearNum = sp.year ? Number(sp.year) : finished.year;
  const year = Number.isInteger(yearNum) && yearNum >= 2000 && yearNum <= 2100 ? yearNum : finished.year;
  const sheet = await getSalesSummaryWorksheet(user, year);

  return (
    <>
      <PageHeader title={TAX_WORKSHEET_PAGES.salesSummary.title} subtitle={taxWorksheetDisclaimer(settings.identity.appShortName, settings.taxYear.isVatRegistered)} />
      <BooksNav active="tax" />
      <TaxNav active="salesSummary" />
      <TaxWorksheetBanner />
      <div className="card">
        <TaxQuarterFilters
          basePath="/books/tax/sales-summary"
          year={year}
          quarter={finished.quarter}
          showQuarter={false}
          exportHref={`/books/tax/sales-summary/export?year=${year}`}
          printHref={`/print/books/tax/sales-summary?year=${year}`}
        />
        <p className="faint small">
          Non-void billings by invoice date (Manila), less customer returns posted in each month. Year net total{" "}
          <Link href={`/books/sales?from=${year}-01-01&to=${year}-12-31`}>{formatPeso(sheet.yearTotal)}</Link> (gross{" "}
          {formatPeso(sheet.yearGross)}, less returns {formatPeso(sheet.yearReturns)}) · {sheet.billingCount} billing
          {sheet.billingCount === 1 ? "" : "s"}. Never includes VAT.
        </p>

        {sheet.billingCount === 0 ? (
          <EmptyState title="No sales this year" line={TAX_WORKSHEET_PAGES.salesSummary.empty} />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">Gross sales</th>
                <th className="num">Less returns</th>
                <th className="num">Net sales</th>
                <th className="num">Billings</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {sheet.months.map((m) => (
                <tr key={m.month}>
                  <td>{m.label}</td>
                  <td className="num">
                    <Link href={m.href}>{formatPeso(m.grossSales)}</Link>
                  </td>
                  <td className="num">{formatPeso(m.returns)}</td>
                  <td className="num">{formatPeso(m.netSales)}</td>
                  <td className="num">{m.billingCount}</td>
                  <td className="small">
                    <Link href={m.href}>Sales register</Link>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>
                  <b>Year total</b>
                </td>
                <td className="num">
                  <b>{formatPeso(sheet.yearGross)}</b>
                </td>
                <td className="num">
                  <b>{formatPeso(sheet.yearReturns)}</b>
                </td>
                <td className="num">
                  <b>{formatPeso(sheet.yearTotal)}</b>
                </td>
                <td className="num">
                  <b>{sheet.billingCount}</b>
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </>
  );
}
