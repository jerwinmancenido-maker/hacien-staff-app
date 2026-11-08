import { notFound, redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/format";
import { canSeeCosts } from "@/lib/permissions";
import { getSettingsSnapshot } from "@/lib/settings";
import { editableItems, getQuoteView } from "@/lib/quotes/views";
import { PageHeader } from "@/components/ui";
import { QuoteEditor } from "@/components/docs/QuoteEditor";
import { editorCustomers, editorRates, editorStaffUsers, editorSuppliers } from "../../editor-data";
import { confirmNoneAndMarkQuoteSentAction, createQuoteAddressAction, markQuoteSentAction, saveQuoteAction } from "../../actions";

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("edit_data");
  const { id } = await params;
  const quote = await getQuoteView(id, user);
  if (!quote) notFound();
  if (quote.status !== "DRAFT" && quote.status !== "SENT") redirect(`/quotes/${id}`);
  const { settings } = await getSettingsSnapshot();
  const withCosts = canSeeCosts(user);
  const [active, inactiveCurrent, rates, suppliers, staffUsers] = await Promise.all([
    editorCustomers(),
    editorCustomers({ id: quote.customer.id }),
    editorRates(quote.withholding),
    editorSuppliers(user),
    editorStaffUsers(quote.preparedById),
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
        approvalStatus={quote.approvalStatus}
        customers={customers}
        rates={rates}
        suppliers={suppliers}
        termsOptions={settings.lists.paymentTerms}
        contactRoles={settings.lists.contactRoles}
        defaultValidityDays={settings.quotes.defaultValidityDays}
        printDefaults={{
          quoteTerms: settings.print.quoteTerms ?? "",
          deliveryNotes: settings.print.deliveryNotes ?? "",
          warrantyNotes: settings.print.warrantyNotes ?? "",
        }}
        staffUsers={staffUsers}
        preparedById={quote.preparedById}
        deliveryAddressId={quote.deliveryAddressId}
        addAddressAction={createQuoteAddressAction}
        approvedByName={quote.approvedBy}
        approvedAt={quote.approvedAt ? formatDateTime(quote.approvedAt) : null}
        action={saveQuoteAction.bind(null, id)}
        cancelHref={`/quotes/${id}`}
        markSentAction={markQuoteSentAction}
        confirmNoneAndMarkSentAction={confirmNoneAndMarkQuoteSentAction}
        initial={{
          customerId: quote.customer.id,
          contactId: quote.contact?.id ?? "",
          date: quote.date,
          validUntil: quote.validUntil,
          validForDays: quote.validityDays,
          terms: quote.terms ?? "",
          notes: quote.notes ?? "",
          internalNotes: quote.internalNotes ?? "",
          deliveryNotes: quote.deliveryNotes ?? "",
          warrantyNotes: quote.warrantyNotes ?? "",
          leadTimeDays: quote.leadTimeDays ?? null,
          subject: quote.subject ?? "",
          withholdingPick: quote.withholdingPick,
          withholdingCodes: quote.withholdingPick,
          buyerPoNo: quote.buyerPoNo ?? "",
          buyerPoDate: "",
          deliveryAddress: "",
          items: editableItems(quote.items, withCosts).map((i) => ({
            ...i,
            supplierId: i.supplierId ?? null,
            supplierUnitCost: i.supplierUnitCost ?? "",
            withholdingRate: i.withholdingRate,
            withholdingAtc: i.withholdingAtc ?? null,
            withholdingOverride: i.withholdingOverride ?? false,
            itemId: i.itemId ?? null,
            itemName: i.itemName ?? null,
          })),
        }}
      />
    </>
  );
}
