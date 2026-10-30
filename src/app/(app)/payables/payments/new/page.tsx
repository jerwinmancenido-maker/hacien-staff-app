import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { formatPeso, manilaToday } from "@/lib/format";
import { ymd } from "@/lib/documents/common";
import { openSupplierBillsForPayment } from "@/lib/services/supplier-payments";
import { supplierPayableBalance } from "@/lib/payables/views";
import { PaymentForm } from "@/components/payables/PaymentForm";
import { PayablesNav } from "@/components/payables/PayablesNav";
import { EmptyState, PageHeader } from "@/components/ui";
import { recordSupplierPaymentAction } from "../../actions";

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<{ supplierId?: string }> }) {
  const user = await requirePagePermission("view");
  const canManage = can(user, "manage_payables");
  const sp = await searchParams;
  const suppliers = await db.supplier.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
    take: 500,
  });

  if (!sp.supplierId) {
    const withBalances = await Promise.all(
      suppliers.map(async (s) => ({ ...s, balance: await supplierPayableBalance(s.id) })),
    );
    const owing = withBalances.filter((s) => Number(s.balance) > 0);

    return (
      <>
        <PageHeader title="Record a payment" subtitle="Choose who you paid. Only unpaid supplier bills show next." />
        <PayablesNav active="payments" />
        <div className="card">
          {!canManage ? (
            <EmptyState title="View only" line="Ask an Admin or Approver if you need a payment recorded." />
          ) : owing.length === 0 ? (
            <div className="empty" style={{ padding: "8px 0" }}>
              <EmptyState
                title="Nothing to pay"
                line="No supplier has an unpaid bill yet. Record a supplier bill on a PO first."
              />
              <p style={{ marginTop: 12 }}>
                <Link className="btn" href="/purchase-orders">
                  Go to supplier POs
                </Link>
              </p>
            </div>
          ) : (
            <>
              <p className="faint small" style={{ marginBottom: 12 }}>
                Suppliers with an open balance:
              </p>
              <ul className="plain-list">
                {owing.map((s) => (
                  <li key={s.id} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "8px 0" }}>
                    <Link href={`/payables/payments/new?supplierId=${s.id}`}>{s.name}</Link>
                    <span className="num faint">{formatPeso(s.balance)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </>
    );
  }

  const supplier =
    suppliers.find((s) => s.id === sp.supplierId) ??
    (await db.supplier.findUnique({ where: { id: sp.supplierId }, select: { id: true, name: true } }));
  if (!supplier) notFound();
  const open = await openSupplierBillsForPayment(supplier.id);
  const today = ymd(manilaToday())!;

  return (
    <>
      <PageHeader
        title="Record a payment"
        subtitle={`Paying ${supplier.name}. Enter what left the bank, then check the bills below.`}
      />
      <PayablesNav active="payments" />
      <div className="card">
        <PaymentForm
          action={recordSupplierPaymentAction}
          supplierId={supplier.id}
          supplierName={supplier.name}
          defaults={{ date: today, amountPaid: "", method: "BANK_TRANSFER" }}
          openBills={open.map((b) => ({
            id: b.id,
            billNumber: b.billNumber,
            dueDate: ymd(b.dueDate)!,
            amount: b.amount,
            balance: b.balance,
            purchaseOrderId: b.purchaseOrderId,
          }))}
          canEdit={canManage}
        />
      </div>
    </>
  );
}
