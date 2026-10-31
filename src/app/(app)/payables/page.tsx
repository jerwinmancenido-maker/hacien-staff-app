import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { formatPeso } from "@/lib/format";
import { apAgingSummary } from "@/lib/payables/views";
import { AGING_BUCKET_LABELS, AGING_BUCKETS } from "@/lib/billing/aging";
import { PayablesNav } from "@/components/payables/PayablesNav";
import { PageHeader } from "@/components/ui";
import { PlusIcon } from "@/components/Icons";

export default async function PayablesHomePage() {
  const user = await requirePagePermission("view");
  const canManage = can(user, "manage_payables");
  const summary = await apAgingSummary();

  return (
    <>
      <PageHeader
        title="Payables"
        subtitle="Record payments already made at the bank. The app never connects to a bank or sends email."
        actions={
          canManage && (
            <Link className="btn" href="/payables/payments/new">
              <PlusIcon /> Record payment
            </Link>
          )
        }
      />
      <PayablesNav active="home" />

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <Link className="card stat stat-link" href="/payables/aging">
          <div className="label">Total payable</div>
          <div className="value num">{formatPeso(summary.totalPayable)}</div>
          <div className="foot">Open supplier bill balances</div>
        </Link>
        <Link className="card stat stat-link" href="/payables/2307?status=TO_ISSUE">
          <div className="label">2307 to issue</div>
          <div className="value num">{formatPeso(summary.pending2307ToIssue)}</div>
          <div className="foot">EWT pending certificate (unverified)</div>
        </Link>
        <Link className="card stat stat-link" href="/payables/payments">
          <div className="label">Suppliers with balance</div>
          <div className="value num">{summary.bySupplier.length}</div>
          <div className="foot">With unpaid bills</div>
        </Link>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>AP by supplier</h2>
          <div className="right">
            <Link className="btn-link small" href="/payables/aging">
              Full aging →
            </Link>
          </div>
        </div>
        {summary.bySupplier.length === 0 ? (
          <div className="empty" style={{ padding: "16px 0" }}>
            <p className="faint">No open payables yet.</p>
            <p className="faint small">Record a supplier bill on a purchase order, then come back to pay it.</p>
            {canManage && (
              <p style={{ marginTop: 12 }}>
                <Link className="btn btn-secondary" href="/purchase-orders">
                  Go to supplier POs
                </Link>{" "}
                <Link className="btn" href="/payables/payments/new">
                  Record payment
                </Link>
              </p>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="list" aria-label="AP by supplier">
              <thead>
                <tr>
                  <th>Supplier</th>
                  {AGING_BUCKETS.map((b) => (
                    <th key={b} className="num">
                      {AGING_BUCKET_LABELS[b]}
                    </th>
                  ))}
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {summary.bySupplier.slice(0, 15).map((r) => (
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
