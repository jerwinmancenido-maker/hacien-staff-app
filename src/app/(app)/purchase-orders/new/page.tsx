import { requireCostPage } from "@/lib/auth/current-user";
import { getSettingsSnapshot } from "@/lib/settings";
import { isoDate, manilaToday } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PoEditor } from "@/components/purchasing/PoEditor";
import { poEditorSuppliers } from "../editor-data";
import { savePurchaseOrderAction } from "../actions";

export default async function NewPurchaseOrderPage({ searchParams }: { searchParams: Promise<{ supplier?: string }> }) {
  await requireCostPage("edit_data");
  const { supplier } = await searchParams;
  const [suppliers, snap] = await Promise.all([poEditorSuppliers(), getSettingsSnapshot()]);
  const s = suppliers.find((x) => x.id === supplier);
  return (
    <>
      <PageHeader title="New standalone PO" subtitle="Not linked to a sales order. To buy for a sales order, open it and choose Create POs." />
      <PoEditor
        isNew
        suppliers={suppliers}
        termsOptions={snap.settings.lists.paymentTerms}
        initial={{
          supplierId: s?.id ?? "",
          supplierContactId: s?.contacts.find((c) => c.isMain)?.id ?? "",
          date: isoDate(manilaToday()),
          expectedDate: "",
          terms: s?.defaultTerms ?? "",
          deliveryAddressText: snap.settings.company.address,
          supplierAddressText: s?.address ?? "",
          notes: "",
          items: [],
        }}
        action={savePurchaseOrderAction.bind(null, null)}
        cancelHref="/purchase-orders"
      />
    </>
  );
}
