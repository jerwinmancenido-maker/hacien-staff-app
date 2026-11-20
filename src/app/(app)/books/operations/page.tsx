import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { BOOKS_DISCLAIMER } from "@/lib/books/config";
import { formatPeso } from "@/lib/format";
import { BooksBanner } from "@/components/books/BooksBanner";
import { BooksNav } from "@/components/books/BooksNav";
import { PageHeader } from "@/components/ui";
import { profitMonth } from "@/lib/services/profit";
import { getOperationalProfit } from "@/lib/services/reconciliation";

// Operational profit (PR-C): every recorded order, billed or not, grouped
// by business. A management view over the same single set of records — it
// is NOT the Books figure and never feeds tax. The official billed
// revenue and net profit (Monthly profit) are shown at the bottom for
// comparison, so the two profit figures can be reconciled.
export default async function OperationsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await requirePagePermission("view_books");
  const sp = await searchParams;
  const month = profitMonth(sp.month);
  const report = await getOperationalProfit(user, month);
  const rows = [...report.rows, report.combined];
  return (
    <>
      <PageHeader title="Operations — sales & profit by business" subtitle={`Management view, not a BIR book. · ${BOOKS_DISCLAIMER}`} />
      <BooksNav active="operations" />
      <BooksBanner />
      <div className="card">
        <form className="toolbar" action="/books/operations" method="get">
          <label htmlFor="month">Month</label>
          <input id="month" name="month" type="month" defaultValue={month} />
          <button className="btn btn-secondary" type="submit">
            Show
          </button>
          <Link className="btn btn-secondary" href={`/books/operations/export?month=${month}`}>
            Export CSV
          </Link>
        </form>
        <p className="faint small">
          Recorded sales are the contract prices of sales orders dated in {month}, whether billed or not. Profit is
          recorded sales minus supplier costs on those orders minus posted expenses in {month}. Each business stands
          on its own; the last row is the combined total.
        </p>
        <div className="table-wrap">
          <table className="list" aria-label="Operational profit by business">
            <thead>
              <tr>
                <th>Business</th>
                <th className="num">Orders</th>
                <th className="num">Recorded sales</th>
                <th className="num">Supplier costs</th>
                <th className="num">Expenses</th>
                <th className="num">Profit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} style={r.label === "All businesses" ? { fontWeight: 600 } : undefined}>
                  <td>{r.label}</td>
                  <td className="num">{r.orderCount}</td>
                  <td className="num">{formatPeso(r.sales)}</td>
                  <td className="num">{formatPeso(r.supplierCosts)}</td>
                  <td className="num">{formatPeso(r.expenses)}</td>
                  <td className="num">{formatPeso(r.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="faint small" style={{ marginBottom: 0 }}>
          For comparison: official billed revenue for {month} (Books, own company only) is{" "}
          {formatPeso(report.officialBilledRevenue)}, and the official net profit is {formatPeso(report.officialNet)}.
          Those are the figures the Books and tax worksheets use — this page never feeds them.
        </p>
      </div>
    </>
  );
}
