import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { SAWT_CSV_FORMAT_LABEL, TAX_WORKSHEET_DISCLAIMER, TAX_WORKSHEET_PAGES } from "@/lib/tax/constants";
import { parseTaxQuarter } from "@/lib/tax/quarters";
import { getCustomer2307Worksheet } from "@/lib/services/tax-worksheets";
import { formatPeso } from "@/lib/format";
import { BooksNav } from "@/components/books/BooksNav";
import { TaxNav } from "@/components/books/TaxNav";
import { TaxQuarterFilters } from "@/components/books/TaxQuarterFilters";
import { TaxWorksheetBanner } from "@/components/books/TaxWorksheetBanner";
import { Chip, EmptyState, PageHeader } from "@/components/ui";

export default async function Customer2307WorksheetPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; quarter?: string }>;
}) {
  const user = await requirePagePermission("view_books");
  const sp = await searchParams;
  const period = parseTaxQuarter(sp.year, sp.quarter);
  const sheet = await getCustomer2307Worksheet(user, period.year, period.quarter);
  const q = `year=${period.year}&quarter=${period.quarter}`;

  return (
    <>
      <PageHeader title={TAX_WORKSHEET_PAGES.received2307.title} subtitle={TAX_WORKSHEET_DISCLAIMER} />
      <BooksNav active="tax" />
      <TaxNav active="received2307" />
      <TaxWorksheetBanner />
      <div className="card">
        <TaxQuarterFilters
          basePath="/books/tax/2307-received"
          year={period.year}
          quarter={period.quarter}
          exportHref={`/books/tax/2307-received/export?${q}`}
          printHref={`/print/books/tax/2307-received?${q}`}
        />
        <p className="faint small">
          CSV export uses SAWT-style column order — <b>{SAWT_CSV_FORMAT_LABEL}</b>. Totals: income{" "}
          <Link href={`/billing/2307`}>{formatPeso(sheet.totalIncome)}</Link> · tax withheld{" "}
          <Link href={`/billing/2307`}>{formatPeso(sheet.totalTax)}</Link> · pending {sheet.pendingCount} ·
          received {sheet.receivedCount}.
        </p>

        {sheet.rows.length === 0 ? (
          <EmptyState title="No 2307s this quarter" line={TAX_WORKSHEET_PAGES.received2307.empty} />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>TIN</th>
                <th>ATC</th>
                <th className="num">Income amount</th>
                <th className="num">Tax withheld</th>
                <th>2307 form</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/customers/${r.customerId}`}>{r.name}</Link>
                  </td>
                  <td>{r.tin || "—"}</td>
                  <td>{r.atc || "—"}</td>
                  <td className="num">{formatPeso(r.incomeAmount)}</td>
                  <td className="num">
                    <Link href={r.href}>{formatPeso(r.taxWithheld)}</Link>
                  </td>
                  <td>
                    <Chip tone={r.status === "Received" ? "green" : "amber"}>{r.status}</Chip>
                  </td>
                  <td className="small">
                    {r.collectionNumber ? (
                      <Link href={r.href}>
                        {r.collectionNumber}
                        {r.collectionDate ? ` · ${r.collectionDate}` : ""}
                      </Link>
                    ) : (
                      "—"
                    )}
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
                  <b>{formatPeso(sheet.totalIncome)}</b>
                </td>
                <td className="num">
                  <b>{formatPeso(sheet.totalTax)}</b>
                </td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </>
  );
}
