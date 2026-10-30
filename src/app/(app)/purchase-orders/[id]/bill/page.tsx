import { notFound } from "next/navigation";
import { requireCostPage } from "@/lib/auth/current-user";
import { getPurchaseOrderView } from "@/lib/purchasing/views";
import { canPo } from "@/lib/purchasing/status";
import { uploadMaxMb } from "@/lib/business-docs/sniff";
import { isoDate, manilaToday } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/ui";
import { BillForm } from "@/components/purchasing/BillForm";
import { recordBillAction } from "../../actions";

export default async function RecordBillPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireCostPage("edit_data");
  const { id } = await params;
  const po = await getPurchaseOrderView(id, user);
  if (!po) notFound();
  return (
    <>
      <PageHeader title={`Record supplier bill · ${po.number}`} subtitle={`${po.supplier.name} · PO total ${po.subtotal}`} />
      {canPo(po.status, "bill") ? (
        <BillForm
          lines={po.items.map((i) => ({ id: i.id, description: i.description, unit: i.unit, qty: i.qty, unitCost: i.unitCost, receivedQty: i.receivedQty }))}
          defaultDate={isoDate(manilaToday())}
          action={recordBillAction.bind(null, id)}
          cancelHref={`/purchase-orders/${id}?tab=match`}
          maxMb={uploadMaxMb()}
        />
      ) : (
        <div className="card">
          <EmptyState title="Not yet" line="Bills can be recorded once the PO is sent." />
        </div>
      )}
    </>
  );
}
