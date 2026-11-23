import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { BOOKS_DISCLAIMER } from "@/lib/books/config";
import { getMonthlyProfit, profitMonth } from "@/lib/services/profit";
import { formatDate, formatPeso } from "@/lib/format";
import { BooksBanner } from "@/components/books/BooksBanner";
import { BooksNav } from "@/components/books/BooksNav";
import { EmptyState, PageHeader } from "@/components/ui";

/** YMD string -> settled date style, via the shared formatDate() (the local day() wrapper pattern). */
const day = (ymdStr: string) => (ymdStr ? formatDate(new Date(`${ymdStr}T00:00:00.000Z`)) : ymdStr);

// S-53: monthly net profit + margin by deal. Who owes us / who we owe already
// live on the billing and payables aging pages, linked below.
export default async function MonthlyProfitPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requirePagePermission("view_books");
  const sp = await searchParams;
  const month = profitMonth(sp.month);
  const report = await getMonthlyProfit(month);
  const dealTotals = report.deals.reduce(
    (a, d) => ({
      contractPrice: a.contractPrice + Number(d.contractPrice),
      returns: a.returns + Number(d.returns),
      supplierCost: a.supplierCost + Number(d.supplierCost),
      margin: a.margin + Number(d.margin),
    }),
    { contractPrice: 0, returns: 0, supplierCost: 0, margin: 0 },
  );
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
          Revenue is billings invoiced in {month}, less customer returns posted in {month}. Supplier bills are bills recorded in {month}, less supplier
          returns posted in {month}. Expenses are posted expenses dated in {month}. Net is revenue minus supplier bills (payables) minus expenses. Margin by deal is
          contract price (less the deal&apos;s returns) minus supplier cost for sales orders dated in {month}.
        </p>
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <div className="card stat">
            <div className="label">Revenue</div>
            <div className="value num">{formatPeso(report.revenue)}</div>
          </div>
          <div className="card stat">
            <div className="label">Customer returns</div>
            <div className="value num">{formatPeso(report.customerReturns)}</div>
          </div>
          <div className="card stat">
            <div className="label">Supplier bills</div>
            <div className="value num">{formatPeso(report.supplierBills)}</div>
          </div>
          <div className="card stat">
            <div className="label">Supplier returns</div>
            <div className="value num">{formatPeso(report.supplierReturns)}</div>
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
                  <th className="col-phone-hide">Date</th>
                  <th className="num col-phone-hide">Contract price (net)</th>
                  <th className="num col-phone-hide col-tab-hide">Returns</th>
                  <th className="num col-phone-hide col-tab-hide">Supplier cost</th>
                  <th className="num">Margin</th>
                  <th className="num">Margin %</th>
                </tr>
              </thead>
              <tbody>
                {report.deals.map((d) => (
                  <tr key={d.number}>
                    <td className="strong" data-col="number">{d.number}</td>
                    <td data-col="date" className="col-phone-hide">{day(d.date)}</td>
                    <td className="num col-phone-hide">{formatPeso(d.contractPrice)}</td>
                    <td className="num col-phone-hide col-tab-hide">{formatPeso(d.returns)}</td>
                    <td className="num col-phone-hide col-tab-hide">{formatPeso(d.supplierCost)}</td>
                    <td className="num">{formatPeso(d.margin)}</td>
                    <td className="num">{d.marginPct === null ? "—" : `${d.marginPct}%`}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="strong" colSpan={2}>
                    Total — deals dated in {month}
                  </td>
                  <td className="num strong col-phone-hide">{formatPeso(dealTotals.contractPrice)}</td>
                  <td className="num strong col-phone-hide col-tab-hide">{formatPeso(dealTotals.returns)}</td>
                  <td className="num strong col-phone-hide col-tab-hide">{formatPeso(dealTotals.supplierCost)}</td>
                  <td className="num strong">{formatPeso(dealTotals.margin)}</td>
                  <td className="num" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="faint small" style={{ marginTop: 12 }}>
          Margin by deal follows orders dated in {month} at their recorded supplier costs — the same basis as the Operations view, which also takes
          expenses off its total. Net profit above follows billings invoiced and supplier bills recorded in {month} instead. The two profit figures
          differ because one follows orders and the other follows invoices and bills; neither is wrong.
        </p>
        <p className="faint small" style={{ marginTop: 16 }}>
          Who owes us: <Link href="/billing/aging">Billing aging →</Link> · Who we owe: <Link href="/payables/aging">Payables aging →</Link>
        </p>
      </div>
    </>
  );
}
