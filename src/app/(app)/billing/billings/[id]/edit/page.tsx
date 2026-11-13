import { notFound, redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { money } from "@/lib/documents/common";
import { getSettingsSnapshot } from "@/lib/settings";
import { remainingToBill } from "@/lib/billing/status";
import { getBillingView } from "@/lib/billing/views";
import { BillingNav } from "@/components/billing/BillingNav";
import { BillingForm } from "@/components/billing/BillingForm";
import { PageHeader } from "@/components/ui";
import { updateBillingAction } from "../../../actions";

// Phase 2 D5 (decided by Jerwin 2026-11-13): the billing-edit screen.
// The backend updateBilling service + updateBillingAction already exist
// and are fully guarded (manage_billing, VOID refused, posted collections
// refused, amount capped at the SO's remaining-to-bill, booklet number
// uniqueness, audit row). This page is only the UI on top of them.
export default async function EditBillingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("view");
  if (!can(user, "manage_billing")) redirect("/no-access");
  const { id } = await params;
  const b = await getBillingView(id);
  if (!b) notFound();
  if (b.status === "VOID") redirect(`/billing/billings/${id}`);

  // Mirror the service guards up front so staff see why, not just an error:
  // posted collections lock the billing, and a closed/void SO locks it too.
  // (The service still enforces both — this is presentation only.)
  const blocked =
    b.allocations.length > 0
      ? "This billing has posted collections; void those first before editing."
      : b.salesOrder.status !== "OPEN"
        ? "The sales order is closed or void; this billing can't be edited."
        : null;

  // Remaining-to-bill for the edit cap EXCLUDES this billing (the service
  // recomputes the same way), so the form's cap includes its own amount.
  const others = await db.billing.findMany({
    where: { salesOrderId: b.salesOrder.id, status: { not: "VOID" }, id: { not: id } },
    select: { amount: true },
  });
  const remaining = remainingToBill(
    b.salesOrder.contractPrice,
    others.map((o) => money(o.amount)),
  );

  const snap = await getSettingsSnapshot();

  return (
    <>
      <PageHeader
        title={`Edit billing ${b.number}`}
        subtitle={`${b.customer.name} · ${b.salesOrder.number} · changes are audited`}
      />
      <BillingNav active="billings" />
      <div className="card">
        {blocked ? (
          <div className="alert error" role="status">
            {blocked}
          </div>
        ) : (
          <BillingForm
            action={updateBillingAction.bind(null, id)}
            canEdit
            submitLabel="Save changes"
            cancelHref={`/billing/billings/${id}`}
            showFiles={false}
            salesOrderLabel={`${b.salesOrder.number} · ${b.customer.name}`}
            remaining={remaining}
            nextInvoiceHint={null}
            seriesFrom={snap.settings.invoiceBooklet.seriesFrom}
            seriesTo={snap.settings.invoiceBooklet.seriesTo}
            defaults={{
              salesOrderId: b.salesOrder.id,
              amount: b.amount,
              invoiceNo: String(b.invoiceNo),
              invoiceDate: b.invoiceDate,
              dueDate: b.dueDate,
              notes: b.notes ?? "",
            }}
          />
        )}
      </div>
    </>
  );
}
