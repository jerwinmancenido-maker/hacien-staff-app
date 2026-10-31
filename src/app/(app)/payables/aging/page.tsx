import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { formatPeso } from "@/lib/format";
import { apAgingSummary } from "@/lib/payables/views";
import { AGING_BUCKET_LABELS, AGING_BUCKETS } from "@/lib/billing/aging";
import { PayablesNav } from "@/components/payables/PayablesNav";
import { PageHeader } from "@/components/ui";

export default async function PayablesAgingPage() {
  await requirePagePermission("view");
  const summary = await apAgingSummary();

  return (
    <>
      <PageHeader title="AP aging" subtitle="Balances by days past due from supplier bill due dates (Manila)." />
      <PayablesNav active="aging" />
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="card stat">
          <div className="label">Total payable</div>
          <div className="value num">{formatPeso(summary.totalPayable)}</div>
        </div>
        {AGING_BUCKETS.map((b) => (
          <div key={b} className="card stat">
            <div className="label">{AGING_BUCKET_LABELS[b]}</div>
            <div className="value num">{formatPeso(summary.totals[b])}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="list" aria-label="Aging by supplier">
            <thead>
              <tr>
                <th>Supplier</th>
                {AGING_BUCKETS.map((b) => (
                  <th key={b} className="num">
                    {AGING_BUCKET_LABELS[b]}
                  </th>
                ))}
                <th className="num">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
                  {summary.bySupplier.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="empty" style={{ padding: "24px 8px" }}>
                      <p className="faint">Nothing outstanding — no unpaid supplier bills.</p>
                      <p style={{ marginTop: 8 }}>
                        <Link className="btn-link" href="/purchase-orders">
                          Record a supplier bill on a PO →
                        </Link>
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                summary.bySupplier.map((r) => (
                  <tr key={r.supplierId}>
                    <td>
                      <Link href={`/suppliers/${r.supplierId}?tab=payments`}>{r.supplierName}</Link>
                    </td>
                    {AGING_BUCKETS.map((b) => (
                      <td key={b} className="num">
                        {formatPeso(r.aging[b])}
                      </td>
                    ))}
                    <td className="num strong">{formatPeso(r.aging.total)}</td>
                    <td>
                      <Link className="btn-link small" href={`/payables/payments?supplierId=${r.supplierId}`}>
                        Payments
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
