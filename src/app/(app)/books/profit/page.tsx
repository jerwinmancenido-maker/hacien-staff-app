import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { BOOKS_DISCLAIMER } from "@/lib/books/config";
import { getMonthlyProfit, profitMonth } from "@/lib/services/profit";
import { formatPeso } from "@/lib/format";
import { BooksBanner } from "@/components/books/BooksBanner";
import { BooksNav } from "@/components/books/BooksNav";
import { EmptyState, PageHeader } from "@/components/ui";

// S-53: monthly net profit + margin by deal. Who owes us / who we owe already
// live on the billing and payables aging pages, linked below.
export default async function MonthlyProfitPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requirePagePermission("view_books");
  const sp = await searchParams;
  const month = profitMonth(sp.month);
  const report = await getMonthlyProfit(month);
  return (
    <>
      <PageHeader title="Monthly profit" subtitle={`Management view, not a BIR book. · ${BOOKS_DISCLAIMER}`} />
      <BooksNav active="profit" />
      <BooksBanner />
      <div className="card">
        <form className="toolbar" action="/books/profit" method="get">
          <label htmlFor="month">Month</label>
          <input id="month" name="month" type="month" defaultValue={month} />
          <button className="btn btn-secondary" type="submit">
            Show
          </button>
          <Link className="btn btn-secondary" href={`/books/profit/export?month=${month}`}>
            Export CSV
          </Link>
        </form>
        <p className="faint small">
          Revenue is billings invoiced in {month}. Supplier bills are bills recorded in {month}. Expenses are posted expenses dated in {month}.
          Net is revenue minus supplier bills minus expenses. Margin by deal is contract price minus supplier cost for sales orders dated in {month}.
        </p>
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <div className="card stat">
            <div className="label">Revenue</div>
            <div className="value num">{formatPeso(report.revenue)}</div>
          </div>
          <div className="card stat">
            <div className="label">Supplier bills</div>
            <div className="value num">{formatPeso(report.supplierBills)}</div>
          </div>
          <div className="card stat">
            <div className="label">Expenses</div>
            <div className="value num">{formatPeso(report.expenses)}</div>
          </div>
          <div className="card stat">
            <div className="label">Net profit</div>
            <div className="value num">{formatPeso(report.net)}</div>
          </div>
        </div>
        <h2 style={{ marginTop: 0 }}>Margin by deal</h2>
        {report.deals.length === 0 ? (
          <EmptyState line={`No sales orders dated in ${month}.`} />
        ) : (
          <div className="table-wrap">
            <table className="list" aria-label="Margin by deal">
              <thead>
                <tr>
                  <th>Deal</th>
                  <th>Date</th>
                  <th className="num">Contract price</th>
                  <th className="num">Supplier cost</th>
                  <th className="num">Margin</th>
                  <th className="num">Margin %</th>
                </tr>
              </thead>
              <tbody>
                {report.deals.map((d) => (
                  <tr key={d.number}>
                    <td className="strong">{d.number}</td>
                    <td>{d.date}</td>
                    <td className="num">{formatPeso(d.contractPrice)}</td>
                    <td className="num">{formatPeso(d.supplierCost)}</td>
                    <td className="num">{formatPeso(d.margin)}</td>
                    <td className="num">{d.marginPct === null ? "—" : `${d.marginPct}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="faint small" style={{ marginTop: 16 }}>
          Who owes us: <Link href="/billing/aging">Billing aging →</Link> · Who we owe: <Link href="/payables/aging">Payables aging →</Link>
        </p>
      </div>
    </>
  );
}
