import { notFound, redirect } from "next/navigation";
import { requireCostPage } from "@/lib/auth/current-user";
import { getSettingsSnapshot } from "@/lib/settings";
import { getPurchaseOrderEditData } from "@/lib/purchasing/views";
import { PageHeader } from "@/components/ui";
import { PoEditor } from "@/components/purchasing/PoEditor";
import { poEditorSuppliers } from "../../editor-data";
import { savePurchaseOrderAction } from "../../actions";
import { listBusinesses } from "@/lib/services/businesses";
import { can } from "@/lib/permissions";

export default async function EditPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireCostPage("edit_data");
  if (!user.isAdmin) redirect("/no-access");
  const { id } = await params;
  const po = await getPurchaseOrderEditData(id, user);
  if (!po) notFound();
  if (po.status !== "DRAFT" && po.status !== "APPROVED") redirect(`/purchase-orders/${id}`);
  const [suppliers, snap, businesses, allBusinesses] = await Promise.all([
    poEditorSuppliers(po.supplierId),
    getSettingsSnapshot(),
    listBusinesses({ activeOnly: true }),
    listBusinesses(),
  ]);
  const lockedLabel = po.salesOrderId
    ? (allBusinesses.find((b) => b.id === po.businessId)?.name ?? snap.settings.company.name)
    : null;
  return (
    <>
      <PageHeader title={`Edit ${po.number}`} />
      <PoEditor
        isNew={false}
        status={po.status}
        suppliers={suppliers}
        termsOptions={snap.settings.lists.paymentTerms}
        contactRoles={snap.settings.lists.contactRoles}
        businesses={businesses}
        ownCompanyName={snap.settings.company.name}
        canTagBusiness={can(user, "approve")}
        businessLockedLabel={lockedLabel}
        initial={po}
        soPicker={po.soPicker}
        action={savePurchaseOrderAction.bind(null, id)}
        cancelHref={`/purchase-orders/${id}`}
      />
    </>
  );
}
