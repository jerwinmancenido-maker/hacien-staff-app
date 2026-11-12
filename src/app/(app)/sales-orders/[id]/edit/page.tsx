import { notFound, redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { canSeeCosts } from "@/lib/permissions";
import { getSettingsSnapshot } from "@/lib/settings";
import { editableItems, getSalesOrderView, soLineOrderedQty } from "@/lib/quotes/views";
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
  const [customers, suppliers, orderedByLine] = await Promise.all([
    editorCustomers({ id: so.customer.id }),
    editorSuppliers(user),
    soLineOrderedQty(id),
  ]);

  return (
    <>
      <PageHeader title={`Edit ${so.number}`} subtitle={`${so.customer.name} · changes are audited`} />
      {so.changedLineCount > 0 && (
        <p className="small muted">
          {so.changedLineCount} line{so.changedLineCount === 1 ? "" : "s"} changed from quote
        </p>
      )}
      <DocumentEditor
        mode="salesOrder"
        isNew={false}
        customers={customers}
        rates={so.withholding}
        suppliers={suppliers}
        termsOptions={settings.lists.paymentTerms}
        contactRoles={settings.lists.contactRoles}
        action={saveSalesOrderAction.bind(null, id)}
        cancelHref={`/sales-orders/${id}`}
        priceLock={user.isAdmin ? "override" : "locked"}
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
            withholdingRate: i.withholdingRate,
            withholdingAtc: i.withholdingAtc ?? null,
            withholdingOverride: i.withholdingOverride ?? false,
            itemId: i.itemId ?? null,
            itemName: i.itemName ?? null,
            orderedQty: orderedByLine.get(i.id) ?? "0.00",
            deliveredQty: i.deliveredQty ?? "0.00",
            changedVsQuote: i.changedVsQuote,
            changedSummary: i.changedSummary,
          })),
        }}
      />
    </>
  );
}
