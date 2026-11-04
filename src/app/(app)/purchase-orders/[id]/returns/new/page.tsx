import { notFound, redirect } from "next/navigation";
import { requireCostPage } from "@/lib/auth/current-user";
import { getPurchaseOrderView } from "@/lib/purchasing/views";
import { isoDate, manilaToday } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { ReturnForm } from "@/components/purchasing/ReturnForm";
import { postSupplierReturnAction } from "../../../actions";

// S-50: return items to the supplier. Cost page: the credit note amount is money.
export default async function NewSupplierReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireCostPage("view");
  const { id } = await params;
  const po = await getPurchaseOrderView(id, user);
  if (!po) notFound();
  if (!["SENT", "PARTIALLY_RECEIVED", "RECEIVED"].includes(po.status)) redirect(`/purchase-orders/${id}?tab=returns`);
  const lines = po.items.map((i) => ({ id: i.id, description: i.description, unit: i.unit, orderedQty: i.qty, receivedQty: i.receivedQty }));
  return (
    <>
      <PageHeader title={`Return items · ${po.number}`} subtitle={`${po.supplier.name}. Returned quantities come off what was received; the credit note is a reference only.`} />
      <ReturnForm lines={lines} defaultDate={isoDate(manilaToday())} action={postSupplierReturnAction.bind(null, id)} cancelHref={`/purchase-orders/${id}?tab=returns`} />
    </>
  );
}
