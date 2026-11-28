import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can, canMaintainSupplierPayment, canSeeCosts } from "@/lib/permissions";
import { formatDate, formatPeso } from "@/lib/format";
import { listPaymentRequestQueue, type PaymentRequestRow } from "@/lib/payables/payment-requests";
import { PayablesNav } from "@/components/payables/PayablesNav";
import { PaymentRequestStatusChip } from "@/components/payables/PayablesParts";
import { PaymentRequestActions } from "@/components/payables/PaymentRequestActions";
import { EmptyState, PageHeader } from "@/components/ui";
import { approvePaymentRequestAction, rejectPaymentRequestAction } from "./actions";

const day = (ymdStr: string) => formatDate(new Date(`${ymdStr}T00:00:00.000Z`));

function BillCell({ r }: { r: PaymentRequestRow }) {
  return (
    <>
      <Link className="strong" href={`/suppliers/${r.supplier.id}`}>
        {r.supplier.name}
      </Link>
      <div className="small faint">
        Bill{" "}
        {r.bill.purchaseOrderId ? (
          <Link href={`/purchase-orders/${r.bill.purchaseOrderId}?tab=bills`}>{r.bill.billNumber}</Link>
        ) : (
          r.bill.billNumber
        )}
        {r.bill.purchaseOrderNumber ? ` · ${r.bill.purchaseOrderNumber}` : ""} · still owed {formatPeso(r.bill.balance)}
      </div>
    </>
  );
}

export default async function PaymentRequestsPage() {
  const user = await requirePagePermission("view");
  if (!canSeeCosts(user)) {
    return (
      <>
        <PageHeader title="Payment requests" />
        <PayablesNav active="requests" />
        <div className="card">
          <EmptyState title="Costs are hidden" line="Payment requests carry supplier amounts, so they need the “Can see costs” flag." />
        </div>
      </>
    );
  }
  const canApprove = can(user, "approve");
  const canPay = canMaintainSupplierPayment(user);
  const queue = await listPaymentRequestQueue(user.id, canApprove);

  return (
    <>
      <PageHeader
        title="Payment requests"
        subtitle="Requests to pay supplier bills. An approver says yes first — then the payment is recorded the usual way, from the account that actually paid."
      />
      <PayablesNav active="requests" />

      {canApprove && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-head">
            <h2>Waiting for approval</h2>
            <div className="right small muted">{queue.pending.length} waiting</div>
          </div>
          {queue.pending.length === 0 ? (
            <EmptyState line="Nothing is waiting for approval." />
          ) : (
            <div className="table-wrap">
              <table className="list" aria-label="Payment requests waiting for approval">
                <thead>
                  <tr>
                    <th>Supplier / bill</th>
                    <th className="num">Amount</th>
                    <th>Pay by</th>
                    <th>Requested by</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {queue.pending.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <BillCell r={r} />
                        {r.note && <div className="small faint">“{r.note}”</div>}
                      </td>
                      <td className="num strong">{formatPeso(r.amount)}</td>
                      <td data-col="date">{day(r.dueDate)}</td>
                      <td className="small">{r.requestedBy.name}</td>
                      <td style={{ textAlign: "right" }}>
                        <PaymentRequestActions
                          approveAction={approvePaymentRequestAction.bind(null, r.id)}
                          rejectAction={rejectPaymentRequestAction.bind(null, r.id)}
                          amount={r.amount}
                          billNumber={r.bill.billNumber}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {canApprove && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-head">
            <h2>Approved — ready to pay</h2>
            <div className="right small muted">{queue.approved.length} approved</div>
          </div>
          {queue.approved.length === 0 ? (
            <EmptyState line="No approved requests are waiting to be paid." />
          ) : (
            <div className="table-wrap">
              <table className="list" aria-label="Approved payment requests">
                <thead>
                  <tr>
                    <th>Supplier / bill</th>
                    <th className="num">Amount</th>
                    <th>Pay by</th>
                    <th>Approved by</th>
                    {canPay && <th aria-label="Actions" />}
                  </tr>
                </thead>
                <tbody>
                  {queue.approved.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <BillCell r={r} />
                      </td>
                      <td className="num strong">{formatPeso(r.amount)}</td>
                      <td data-col="date">{day(r.dueDate)}</td>
                      <td className="small">{r.decidedBy?.name ?? "—"}</td>
                      {canPay && (
                        <td style={{ textAlign: "right" }}>
                          <Link
                            className="btn btn-secondary small"
                            href={`/payables/payments/new?supplierId=${r.supplier.id}&requestId=${r.id}`}
                          >
                            Record payment
                          </Link>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>My requests</h2>
          <div className="right small muted">Newest first below is by due date — ask for a payment from any open bill on its PO page.</div>
        </div>
        {queue.mine.length === 0 ? (
          <EmptyState line="You haven't requested any payments yet. Open a purchase order's Bills tab and choose “Request payment” on a bill." />
        ) : (
          <div className="table-wrap">
            <table className="list" aria-label="My payment requests">
              <thead>
                <tr>
                  <th>Supplier / bill</th>
                  <th className="num">Amount</th>
                  <th>Pay by</th>
                  <th>Status</th>
                  <th>Decision / payment</th>
                </tr>
              </thead>
              <tbody>
                {queue.mine.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <BillCell r={r} />
                    </td>
                    <td className="num strong">{formatPeso(r.amount)}</td>
                    <td data-col="date">{day(r.dueDate)}</td>
                    <td>
                      <PaymentRequestStatusChip status={r.status} />
                    </td>
                    <td className="small">
                      {r.status === "PAID" && r.payment ? (
                        <>
                          Paid by <Link href={`/payables/payments/${r.payment.id}`}>{r.payment.number}</Link>
                        </>
                      ) : r.decidedBy ? (
                        <>
                          {r.decidedBy.name}
                          {r.decisionNote ? ` — “${r.decisionNote}”` : ""}
                        </>
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
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
