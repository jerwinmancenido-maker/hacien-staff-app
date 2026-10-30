import { notFound, redirect } from "next/navigation";
import { requireCostPage } from "@/lib/auth/current-user";
import { getSettingsSnapshot } from "@/lib/settings";
import { getPurchaseOrderEditData } from "@/lib/purchasing/views";
import { PageHeader } from "@/components/ui";
import { PoEditor } from "@/components/purchasing/PoEditor";
import { poEditorSuppliers } from "../../editor-data";
import { savePurchaseOrderAction } from "../../actions";

export default async function EditPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireCostPage("edit_data");
  const { id } = await params;
  const po = await getPurchaseOrderEditData(id, user);
  if (!po) notFound();
  if (po.status !== "DRAFT" && po.status !== "APPROVED") redirect(`/purchase-orders/${id}`);
  const [suppliers, snap] = await Promise.all([poEditorSuppliers(po.supplierId), getSettingsSnapshot()]);
  return (
    <>
      <PageHeader title={`Edit ${po.number}`} />
      <PoEditor
        isNew={false}
        status={po.status}
        suppliers={suppliers}
        termsOptions={snap.settings.lists.paymentTerms}
        initial={po}
        action={savePurchaseOrderAction.bind(null, id)}
        cancelHref={`/purchase-orders/${id}`}
      />
    </>
  );
}
