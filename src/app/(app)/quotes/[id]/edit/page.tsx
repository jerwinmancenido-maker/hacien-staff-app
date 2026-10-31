import { notFound, redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { canSeeCosts } from "@/lib/permissions";
import { getSettingsSnapshot } from "@/lib/settings";
import { editableItems, getQuoteView } from "@/lib/quotes/views";
import { PageHeader } from "@/components/ui";
import { QuoteEditor } from "@/components/docs/QuoteEditor";
import { editorCustomers, editorRates, editorSuppliers } from "../../editor-data";
import { markQuoteSentAction, saveQuoteAction } from "../../actions";

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
      <PageHeader title={`Edit ${quote.number}`} subtitle={quote.customer.name} />
      <QuoteEditor
        isNew={false}
        quoteId={id}
        quoteNumber={quote.number}
        revision={quote.revision}
        status={quote.status}
        customers={customers}
        rates={rates}
        suppliers={suppliers}
        termsOptions={settings.lists.paymentTerms}
        defaultValidityDays={settings.quotes.defaultValidityDays}
        printDefaults={{
          quoteTerms: settings.print.quoteTerms ?? "",
          deliveryNotes: settings.print.deliveryNotes ?? "",
          warrantyNotes: settings.print.warrantyNotes ?? "",
        }}
        preparedByName={quote.createdBy}
        action={saveQuoteAction.bind(null, id)}
        cancelHref={`/quotes/${id}`}
        markSentAction={markQuoteSentAction}
        initial={{
          customerId: quote.customer.id,
          contactId: quote.contact?.id ?? "",
          date: quote.date,
          validUntil: quote.validUntil,
          terms: quote.terms ?? "",
          notes: quote.notes ?? "",
          internalNotes: quote.internalNotes ?? "",
          subject: quote.subject ?? "",
          buyerPoNo: quote.buyerPoNo ?? "",
          withholdingCodes: quote.withholding.map((w) => w.code),
          buyerPoDate: "",
          deliveryAddress: "",
          items: editableItems(quote.items, withCosts).map((i) => ({
            ...i,
            supplierId: i.supplierId ?? null,
            supplierUnitCost: i.supplierUnitCost ?? "",
            withholdingRate: i.withholdingRate,
            withholdingAtc: i.withholdingAtc ?? null,
            withholdingOverride: i.withholdingOverride ?? false,
          })),
        }}
      />
    </>
  );
}
