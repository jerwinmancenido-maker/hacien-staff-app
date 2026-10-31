import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { formatPeso } from "@/lib/format";
import { arAgingSummary } from "@/lib/billing/views";
import { AGING_BUCKET_LABELS, AGING_BUCKETS } from "@/lib/billing/aging";
import { BillingNav } from "@/components/billing/BillingNav";
import { PageHeader } from "@/components/ui";

export default async function AgingPage() {
  await requirePagePermission("view");
  const summary = await arAgingSummary();

  return (
    <>
      <PageHeader title="AR aging" subtitle={`Balances by days past due (Manila). Grace: ${summary.graceDays} day(s).`} />
      <BillingNav active="aging" />
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="card stat">
          <div className="label">Total receivable</div>
          <div className="value num">{formatPeso(summary.totalReceivable)}</div>
        </div>
        <div className={`card stat${Number(summary.overdue) > 0 ? " stat-red" : ""}`}>
          <div className="label">Overdue</div>
          <div className="value num">{formatPeso(summary.overdue)}</div>
        </div>
        <div className="card stat">
          <div className="label">Customer credit</div>
          <div className="value num">{formatPeso(summary.credit)}</div>
        </div>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="list" aria-label="Aging by customer">
            <thead>
              <tr>
                <th>Customer</th>
                {AGING_BUCKETS.map((b) => (
                  <th key={b} className="num">
                    {AGING_BUCKET_LABELS[b]}
                  </th>
                ))}
                <th className="num">Total</th>
                <th className="num">Overdue</th>
                <th className="num">Credit</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {summary.byCustomer.length === 0 ? (
                <tr>
                  <td colSpan={9} className="faint">
                    Nothing outstanding.
                  </td>
                </tr>
              ) : (
                summary.byCustomer.map((r) => (
                  <tr key={r.customerId}>
                    <td>
                      <Link href={`/customers/${r.customerId}?tab=balances`}>{r.customerName}</Link>
                    </td>
                    {AGING_BUCKETS.map((b) => (
                      <td key={b} className="num">
                        {formatPeso(r.aging[b])}
                      </td>
                    ))}
                    <td className="num strong">{formatPeso(r.aging.total)}</td>
                    <td className="num">{formatPeso(r.overdue)}</td>
                    <td className="num">{formatPeso(r.credit)}</td>
                    <td>
                      <Link className="btn-link small" href={`/billing/billings?customerId=${r.customerId}`}>
                        Billings
                      </Link>{" "}
                      ·{" "}
                      <Link className="btn-link small" href={`/print/statements/${r.customerId}`}>
                        Statement
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
