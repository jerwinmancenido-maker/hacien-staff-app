import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can, canSeeCosts } from "@/lib/permissions";
import { db } from "@/lib/db";
import { money, ymd } from "@/lib/documents/common";
import { formatDate, formatPeso } from "@/lib/format";
import { fromScaled, toScaled } from "@/lib/quotes/calc";
import { supplierBillBalance } from "@/lib/payables/status";
import { openRequestTotalsByBill } from "@/lib/payables/payment-requests";
import { PayablesNav } from "@/components/payables/PayablesNav";
import { PaymentRequestForm } from "@/components/payables/PaymentRequestForm";
import { SupplierBillStatusChip } from "@/components/payables/PayablesParts";
import { EmptyState, PageHeader } from "@/components/ui";
import { createPaymentRequestAction } from "../actions";

export default async function NewPaymentRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ billId?: string }>;
}) {
  const user = await requirePagePermission("view");
  const sp = await searchParams;
  if (!sp.billId) notFound();
  const bill = await db.supplierBill.findUnique({
    where: { id: sp.billId },
    include: {
      supplier: { select: { id: true, name: true } },
      purchaseOrder: { select: { id: true, number: true } },
      allocations: { where: { supplierPayment: { status: "POSTED" } }, select: { cashApplied: true, withholdingApplied: true } },
    },
  });
  if (!bill) notFound();

  const cash = fromScaled(bill.allocations.reduce((a, x) => a + toScaled(money(x.cashApplied), 2), 0n), 2);
  const wh = fromScaled(bill.allocations.reduce((a, x) => a + toScaled(money(x.withholdingApplied), 2), 0n), 2);
  const outstanding = supplierBillBalance(money(bill.amount), { cashApplied: cash, withholdingApplied: wh });
  const openTotals = await openRequestTotalsByBill([bill.id]);
  const openTotal = openTotals.get(bill.id)?.total ?? "0.00";
  const requestable = fromScaled(toScaled(outstanding, 2) - toScaled(openTotal, 2), 2);
  const canRequest = can(user, "edit_data") && canSeeCosts(user);
  const blocked =
    bill.status === "VOID"
      ? "This bill is void — it can't be paid."
      : bill.status === "PAID"
        ? "This bill is already fully paid."
        : toScaled(requestable, 2) <= 0n
          ? `Open payment requests already cover the ${formatPeso(outstanding)} still owed on this bill.`
          : null;

  return (
    <>
      <PageHeader
        title="Request payment"
        subtitle={`Bill ${bill.billNumber} — ${bill.supplier.name}. The request goes to an approver; the payment itself is recorded after approval.`}
      />
      <PayablesNav active="requests" />
      <div className="card">
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <div className="card stat">
            <div className="label">Bill amount</div>
            <div className="value num">{formatPeso(money(bill.amount))}</div>
            <div className="foot">
              <SupplierBillStatusChip status={bill.status} />
            </div>
          </div>
          <div className="card stat">
            <div className="label">Still owed</div>
            <div className="value num">{formatPeso(outstanding)}</div>
            <div className="foot">Due {formatDate(bill.dueDate)}</div>
          </div>
          <div className="card stat">
            <div className="label">Already requested</div>
            <div className="value num">{formatPeso(openTotal)}</div>
            <div className="foot">Waiting or approved, not yet paid</div>
          </div>
        </div>

        {!canRequest ? (
          <EmptyState title="View only" line="Ask an Admin if you need a payment requested." />
        ) : blocked ? (
          <>
            <EmptyState title="Can't request a payment" line={blocked} />
            <p style={{ marginTop: 12 }}>
              <Link className="btn btn-secondary" href="/payables/payment-requests">
                Go to payment requests
              </Link>
            </p>
          </>
        ) : (
          <PaymentRequestForm
            action={createPaymentRequestAction}
            supplierBillId={bill.id}
            defaultAmount={requestable}
            maxAmount={requestable}
            defaultDueDate={ymd(bill.dueDate)!}
          />
        )}
        {bill.purchaseOrder && (
          <p className="faint small" style={{ marginTop: 12 }}>
            From <Link href={`/purchase-orders/${bill.purchaseOrder.id}?tab=bills`}>{bill.purchaseOrder.number} — Bills</Link>
          </p>
        )}
      </div>
    </>
  );
}
