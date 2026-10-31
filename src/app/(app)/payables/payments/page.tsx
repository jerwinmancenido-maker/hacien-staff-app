import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { formatDate, formatPeso } from "@/lib/format";
import { listSupplierPayments } from "@/lib/payables/views";
import { PayablesNav } from "@/components/payables/PayablesNav";
import { PaymentMethodLabel, PaymentStatusChip } from "@/components/payables/PayablesParts";
import { PageHeader } from "@/components/ui";
import { PlusIcon } from "@/components/Icons";
import type { SupplierPaymentStatus } from "@prisma/client";

const day = (ymd: string) => formatDate(new Date(`${ymd}T00:00:00.000Z`));

export default async function PaymentsListPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; supplierId?: string }> }) {
  const user = await requirePagePermission("view");
  const sp = await searchParams;
  const status = (sp.status === "POSTED" || sp.status === "VOID" ? sp.status : "ALL") as SupplierPaymentStatus | "ALL";
  const rows = await listSupplierPayments({ status, q: sp.q, supplierId: sp.supplierId });
  const canManage = can(user, "manage_payables");

  return (
    <>
      <PageHeader
        title="Supplier payments"
        subtitle="Hand-recorded payments. Cash allocated must equal amount paid."
        actions={
          canManage && (
            <Link className="btn" href={`/payables/payments/new${sp.supplierId ? `?supplierId=${sp.supplierId}` : ""}`}>
              <PlusIcon /> Record payment
            </Link>
          )
        }
      />
      <PayablesNav active="payments" />
      <form className="toolbar txn-filters" method="get" action="/payables/payments" style={{ marginBottom: 16 }}>
        {sp.supplierId && <input type="hidden" name="supplierId" value={sp.supplierId} />}
        <input className="input" name="q" defaultValue={sp.q ?? ""} placeholder="Search number, reference, supplier" />
        <select className="input" name="status" defaultValue={status}>
          <option value="ALL">All</option>
          <option value="POSTED">Posted</option>
          <option value="VOID">Void</option>
        </select>
        <button className="btn btn-secondary" type="submit">
          Filter
        </button>
      </form>
      {rows.length === 0 ? (
        <div className="card">
          <div className="empty payments-empty" style={{ padding: "24px 8px" }}>
            <p className="faint">No payments recorded yet.</p>
            {canManage && (
              <div className="empty-actions" style={{ justifyContent: "center" }}>
                <Link className="btn" href="/payables/payments/new">
                  Record the first payment
                </Link>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card payments-table-card">
          <div className="table-wrap">
            <table className="list" aria-label="Supplier payments">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Date</th>
                  <th>Supplier</th>
                  <th>Method</th>
                  <th>Reference</th>
                  <th className="num">Paid</th>
                  <th className="num">EWT</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/payables/payments/${r.id}`}>{r.number}</Link>
                    </td>
                    <td>{day(r.date)}</td>
                    <td>
                      <Link href={`/suppliers/${r.supplier.id}`}>{r.supplier.name}</Link>
                    </td>
                    <td>
                      <PaymentMethodLabel method={r.method} />
                    </td>
                    <td>{r.reference ?? "—"}</td>
                    <td className="num">{formatPeso(r.amountPaid)}</td>
                    <td className="num">{formatPeso(r.withholdingTotal)}</td>
                    <td>
                      <PaymentStatusChip status={r.status} />
                    </td>
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
