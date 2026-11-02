import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { canMaintainSupplierPayment } from "@/lib/permissions";
import { formatDate, formatPeso } from "@/lib/format";
import { listWeOweBills } from "@/lib/payables/we-owe";
import { PayablesNav } from "@/components/payables/PayablesNav";
import { Chip, EmptyState, PageHeader } from "@/components/ui";
import { PlusIcon } from "@/components/Icons";

const day = (d: Date) => formatDate(d);

export default async function WeOwePage() {
  const user = await requirePagePermission("view");
  const canRecord = canMaintainSupplierPayment(user);
  const summary = await listWeOweBills();

  return (
    <>
      <PageHeader
        title="We owe"
        subtitle="Open supplier bills sorted by due date. Fully paid bills disappear from this list."
        actions={
          canRecord && (
            <Link className="btn" href="/payables/payments/new">
              <PlusIcon /> Record payment
            </Link>
          )
        }
      />
      <PayablesNav active="we-owe" />

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="card stat">
          <div className="label">Left to pay</div>
          <div className="value num">{formatPeso(summary.totalLeftToPay)}</div>
          <div className="foot">
            {summary.count} open {summary.count === 1 ? "bill" : "bills"}
          </div>
        </div>
      </div>

      {summary.rows.length === 0 ? (
        <div className="card">
          <div className="empty" style={{ padding: "24px 8px" }}>
            <EmptyState
              title="Nothing owed"
              line="No unpaid supplier bills. All bills are fully paid."
            />
            {canRecord && (
              <p style={{ marginTop: 12 }}>
                <Link className="btn" href="/purchase-orders">
                  Go to supplier POs
                </Link>
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="list" aria-label="We owe — open supplier bills">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Bill no.</th>
                  <th>Due date</th>
                  <th className="num">Amount</th>
                  <th className="num">Paid</th>
                  <th className="num">Left to pay</th>
                  {canRecord && <th aria-label="Actions" />}
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link className="strong" href={`/suppliers/${r.supplier.id}`}>
                        {r.supplier.name}
                      </Link>
                    </td>
                    <td>
                      {r.purchaseOrder ? (
                        <Link href={`/purchase-orders/${r.purchaseOrder.id}?tab=bills`}>
                          {r.billNumber}
                        </Link>
                      ) : (
                        r.billNumber
                      )}
                    </td>
                    <td>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span>{day(r.dueDate)}</span>
                        {r.dueLabel === "Overdue" && <Chip tone="red">Overdue</Chip>}
                        {r.dueLabel === "Due this week" && <Chip tone="grey">Due this week</Chip>}
                      </div>
                    </td>
                    <td className="num">{formatPeso(r.amount)}</td>
                    <td className="num">{formatPeso(r.paid)}</td>
                    <td className="num strong">{formatPeso(r.leftToPay)}</td>
                    {canRecord && (
                      <td style={{ textAlign: "right" }}>
                        <Link
                          className="btn btn-secondary small"
                          href={`/payables/payments/new?supplierId=${r.supplier.id}`}
                        >
                          Pay
                        </Link>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
