import { notFound, redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { canSeeCosts } from "@/lib/permissions";
import { getSettingsSnapshot } from "@/lib/settings";
import { editableItems, getSalesOrderView } from "@/lib/quotes/views";
import { PageHeader } from "@/components/ui";
import { DocumentEditor } from "@/components/docs/DocumentEditor";
import { editorCustomers, editorSuppliers } from "../../../quotes/editor-data";
import { saveSalesOrderAction } from "../../actions";

export default async function EditSalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("edit_data");
  const { id } = await params;
  const so = await getSalesOrderView(id, user);
  if (!so) notFound();
  if (so.status !== "OPEN") redirect(`/sales-orders/${id}`);
  const { settings } = await getSettingsSnapshot();
  const [customers, suppliers] = await Promise.all([editorCustomers({ id: so.customer.id }), editorSuppliers(user)]);

  return (
    <>
      <PageHeader title={`Edit ${so.number}`} subtitle={`${so.customer.name} · changes are audited`} />
      <DocumentEditor
        mode="salesOrder"
        isNew={false}
        customers={customers}
        rates={so.withholding}
        suppliers={suppliers}
        termsOptions={settings.lists.paymentTerms}
        action={saveSalesOrderAction.bind(null, id)}
        cancelHref={`/sales-orders/${id}`}
        initial={{
          customerId: so.customer.id,
          contactId: so.contact?.id ?? "",
          date: so.date,
          validUntil: "",
          terms: so.terms ?? "",
          notes: so.notes ?? "",
          withholdingCodes: so.withholding.map((w) => w.code),
          buyerPoNo: so.buyerPoNo ?? "",
          buyerPoDate: so.buyerPoDate ?? "",
          deliveryAddress: so.deliveryAddress ?? "",
          items: editableItems(so.items, canSeeCosts(user)).map((i) => ({
            ...i,
            supplierId: i.supplierId ?? null,
            supplierUnitCost: i.supplierUnitCost ?? "",
            withholdingRate: i.withholdingRate ?? "0.0000",
            withholdingAtc: i.withholdingAtc ?? null,
            withholdingOverride: i.withholdingOverride ?? false,
          })),
        }}
      />
    </>
  );
}
