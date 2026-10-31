import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import {
  QAP_CSV_FORMAT_LABEL,
  SUPPLIER_EWT_RDO_NOTE,
  TAX_WORKSHEET_DISCLAIMER,
  TAX_WORKSHEET_PAGES,
} from "@/lib/tax/constants";
import { parseTaxQuarter } from "@/lib/tax/quarters";
import { getSupplierEwtWorksheet } from "@/lib/services/tax-worksheets";
import { formatPeso } from "@/lib/format";
import { BooksNav } from "@/components/books/BooksNav";
import { TaxNav } from "@/components/books/TaxNav";
import { TaxQuarterFilters } from "@/components/books/TaxQuarterFilters";
import { TaxWorksheetBanner } from "@/components/books/TaxWorksheetBanner";
import { EmptyState, PageHeader } from "@/components/ui";

export default async function SupplierEwtWorksheetPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; quarter?: string }>;
}) {
  const user = await requirePagePermission("view_books");
  const sp = await searchParams;
  const period = parseTaxQuarter(sp.year, sp.quarter);
  const sheet = await getSupplierEwtWorksheet(user, period.year, period.quarter);
  const q = `year=${period.year}&quarter=${period.quarter}`;

  return (
    <>
      <PageHeader title={TAX_WORKSHEET_PAGES.supplierEwt.title} subtitle={TAX_WORKSHEET_DISCLAIMER} />
      <BooksNav active="tax" />
      <TaxNav active="supplierEwt" />
      <TaxWorksheetBanner />
      <div className="card">
        <TaxQuarterFilters
          basePath="/books/tax/ewt-withheld"
          year={period.year}
          quarter={period.quarter}
          exportHref={`/books/tax/ewt-withheld/export?${q}`}
          printHref={`/print/books/tax/ewt-withheld?${q}`}
        />
        <div className="alert warn" role="note" style={{ marginBottom: 12 }}>
          {SUPPLIER_EWT_RDO_NOTE}
        </div>
        <p className="faint small">
          CSV export uses QAP-style column order — labelled <b>{QAP_CSV_FORMAT_LABEL}</b>. Period total tax{" "}
          <Link href="/payables/payments">{formatPeso(sheet.totalTax)}</Link> · base{" "}
          {formatPeso(sheet.totalBase)}.
        </p>

        <h3 style={{ marginTop: 8 }}>Monthly totals</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Base</th>
              <th className="num">Tax</th>
              <th className="num">Rows</th>
            </tr>
          </thead>
          <tbody>
            {sheet.monthlyTotals.map((m) => (
              <tr key={m.month}>
                <td>{m.label}</td>
                <td className="num">{formatPeso(m.base)}</td>
                <td className="num">{formatPeso(m.tax)}</td>
                <td className="num">{m.count}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Quarterly totals ({period.year})</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>Quarter</th>
              <th className="num">Base</th>
              <th className="num">Tax</th>
              <th className="num">Rows</th>
            </tr>
          </thead>
          <tbody>
            {sheet.quarterlyTotals.map((qq) => (
              <tr key={qq.quarter}>
                <td>
                  <Link href={`/books/tax/ewt-withheld?year=${period.year}&quarter=${qq.quarter}`}>{qq.label}</Link>
                </td>
                <td className="num">{formatPeso(qq.base)}</td>
                <td className="num">{formatPeso(qq.tax)}</td>
                <td className="num">{qq.count}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Detail — {sheet.bounds?.label ?? period.year}</h3>
        {sheet.rows.length === 0 ? (
          <EmptyState title="No supplier EWT this period" line={TAX_WORKSHEET_PAGES.supplierEwt.empty} />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>TIN</th>
                <th>ATC</th>
                <th className="num">Base</th>
                <th>Rate</th>
                <th className="num">Tax</th>
                <th>Payment</th>
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/suppliers/${r.supplierId}`}>{r.name}</Link>
                  </td>
                  <td>{r.tin || "—"}</td>
                  <td>{r.atc || "—"}</td>
                  <td className="num">{formatPeso(r.base)}</td>
                  <td>{(Number(r.rate) * 100).toFixed(2)}%</td>
                  <td className="num">
                    <Link href={r.href}>{formatPeso(r.tax)}</Link>
                  </td>
                  <td className="small">
                    <Link href={r.href}>
                      {r.paymentNumber} · {r.paymentDate}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>
                  <b>Totals</b>
                </td>
                <td className="num">
                  <b>{formatPeso(sheet.totalBase)}</b>
                </td>
                <td></td>
                <td className="num">
                  <b>{formatPeso(sheet.totalTax)}</b>
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
