import { notFound, redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { canSeeCosts } from "@/lib/permissions";
import { getSettingsSnapshot } from "@/lib/settings";
import { editableItems, getQuoteView } from "@/lib/quotes/views";
import { PageHeader } from "@/components/ui";
import { DocumentEditor } from "@/components/docs/DocumentEditor";
import { editorCustomers, editorRates, editorSuppliers } from "../../editor-data";
import { saveQuoteAction } from "../../actions";

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("edit_data");
  const { id } = await params;
  const quote = await getQuoteView(id, user);
  if (!quote) notFound();
  if (quote.status !== "DRAFT" && quote.status !== "SENT") redirect(`/quotes/${id}`);
  const { settings } = await getSettingsSnapshot();
  const withCosts = canSeeCosts(user);
  const [active, inactiveCurrent, rates, suppliers] = await Promise.all([
    editorCustomers(),
    editorCustomers({ id: quote.customer.id }),
    editorRates(quote.withholding),
    editorSuppliers(user),
  ]);
  const customers = active.some((c) => c.id === quote.customer.id) ? active : [...inactiveCurrent, ...active];

  return (
    <>
      <PageHeader title={`Edit ${quote.number}`} subtitle={`Rev ${quote.revision} · ${quote.customer.name}`} />
      <DocumentEditor
        mode="quote"
        isNew={false}
        customers={customers}
        rates={rates}
        suppliers={suppliers}
        termsOptions={settings.lists.paymentTerms}
        action={saveQuoteAction.bind(null, id)}
        cancelHref={`/quotes/${id}`}
        initial={{
          customerId: quote.customer.id,
          contactId: quote.contact?.id ?? "",
          date: quote.date,
          validUntil: quote.validUntil,
          terms: quote.terms ?? "",
          notes: quote.notes ?? "",
          withholdingCodes: quote.withholding.map((w) => w.code),
          buyerPoNo: "",
          buyerPoDate: "",
          deliveryAddress: "",
          items: editableItems(quote.items, withCosts).map((i) => ({
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
