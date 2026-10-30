import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { isBooksEnabled } from "@/lib/books/features";
import {
  QAP_CSV_FORMAT_LABEL,
  SUPPLIER_EWT_RDO_NOTE,
  TAX_WORKSHEET_BANNER,
  TAX_WORKSHEET_DISCLAIMER,
  TAX_WORKSHEET_PAGES,
} from "@/lib/tax/constants";
import { parseTaxQuarter } from "@/lib/tax/quarters";
import { getSupplierEwtWorksheet } from "@/lib/services/tax-worksheets";
import { getSettingsSnapshot } from "@/lib/settings";
import { formatPeso } from "@/lib/format";
import { PrintButton } from "@/components/docs/PrintButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: TAX_WORKSHEET_PAGES.supplierEwt.title };

export default async function PrintSupplierEwtPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; quarter?: string }>;
}) {
  const user = await requirePagePermission("view_books");
  if (!(await isBooksEnabled())) notFound();
  const sp = await searchParams;
  const period = parseTaxQuarter(sp.year, sp.quarter);
  const sheet = await getSupplierEwtWorksheet(user, period.year, period.quarter);
  const { settings } = await getSettingsSnapshot();
  const company = settings.company;
  const q = `year=${period.year}&quarter=${period.quarter}`;

  return (
    <div className="print-shell">
      <div className="print-toolbar no-print">
        <Link className="btn btn-secondary" href={`/books/tax/ewt-withheld?${q}`}>
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
            <h1>{TAX_WORKSHEET_PAGES.supplierEwt.title}</h1>
            <div className="small muted">{TAX_WORKSHEET_DISCLAIMER}</div>
            <div className="small">
              {sheet.bounds?.label} · QAP-style · {QAP_CSV_FORMAT_LABEL}
            </div>
            <div className="small books-draft-stamp">{TAX_WORKSHEET_BANNER}</div>
          </div>
        </header>
        <p className="small">
          <b>{SUPPLIER_EWT_RDO_NOTE}</b>
        </p>
        {sheet.rows.length === 0 ? (
          <p className="faint">{TAX_WORKSHEET_PAGES.supplierEwt.empty}</p>
        ) : (
          <table className="books-register-table">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>TIN</th>
                <th>ATC</th>
                <th className="num">Base</th>
                <th>Rate</th>
                <th className="num">Tax</th>
                <th>Month</th>
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.tin || "—"}</td>
                  <td>{r.atc || "—"}</td>
                  <td className="num">{formatPeso(r.base)}</td>
                  <td>{(Number(r.rate) * 100).toFixed(2)}%</td>
                  <td className="num">{formatPeso(r.tax)}</td>
                  <td>{r.month}</td>
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
      </article>
    </div>
  );
}
