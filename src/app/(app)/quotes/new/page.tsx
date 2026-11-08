import { requirePagePermission } from "@/lib/auth/current-user";
import { getSettingsSnapshot } from "@/lib/settings";
import { addDays, isoDate, manilaToday } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { QuoteEditor } from "@/components/docs/QuoteEditor";
import { customerArSnapshot } from "@/lib/billing/views";
import { formatPeso } from "@/lib/format";
import { editorCustomers, editorRates, editorStaffUsers, editorSuppliers } from "../editor-data";
import { confirmNoneAndMarkQuoteSentAction, createQuoteAddressAction, markQuoteSentAction, saveQuoteAction } from "../actions";

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const user = await requirePagePermission("edit_data");
  const { customer: customerParam } = await searchParams;
  const { settings } = await getSettingsSnapshot();
  const [customers, rates, suppliers, staffUsers] = await Promise.all([
    editorCustomers(),
    editorRates(),
    editorSuppliers(user),
    editorStaffUsers(user.id),
  ]);
  const today = manilaToday();
  const preset = customers.find((c) => c.id === customerParam);
  const presetAr = preset ? await customerArSnapshot(preset.id) : null;
  const presetOverLimit =
    preset && preset.creditLimit != null && presetAr ? Number(presetAr.balanceDue) > Number(preset.creditLimit) : false;
  const withholdingPick = preset ? preset.defaultWithholding : null;

  return (
    <>
      <PageHeader title="New quote" subtitle="Pick the customer, add the lines, and save. The quote number is given on save." />
      {presetOverLimit && presetAr && (
        <div className="alert warn" role="status">
          {preset?.name} is over their credit limit — balance due {formatPeso(presetAr.balanceDue)} vs limit {formatPeso(preset?.creditLimit ?? 0)}. This is a warning only; you can still save the quote.
        </div>
      )}
      <QuoteEditor
        isNew
        quoteId={null}
        quoteNumber={null}
        revision={1}
        status="DRAFT"
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
        staffUsers={staffUsers}
        preparedById={user.id}
        deliveryAddressId={preset?.defaultDeliveryId ?? null}
        addAddressAction={createQuoteAddressAction}
        action={saveQuoteAction.bind(null, null)}
        cancelHref="/quotes"
        markSentAction={markQuoteSentAction}
        confirmNoneAndMarkSentAction={confirmNoneAndMarkQuoteSentAction}
        initial={{
          customerId: preset?.id ?? "",
          contactId: preset?.contacts.find((c) => c.isMain)?.id ?? "",
          date: isoDate(today),
          validUntil: isoDate(addDays(today, settings.quotes.defaultValidityDays)),
          validForDays: settings.quotes.defaultValidityDays,
          terms: preset?.defaultTerms ?? "",
          notes: "",
          internalNotes: "",
          subject: "",
          withholdingPick,
          withholdingCodes: withholdingPick,
          buyerPoNo: "",
          buyerPoDate: "",
          deliveryAddress: "",
          // Terms snapshot (owner 2026-11-07): a new quote starts with the
          // current Settings print defaults as its own Delivery/Warranty
          // text, so later Settings edits do not rewrite this quote.
          // Staff can still edit or clear them per quote before saving.
          deliveryNotes: settings.print.deliveryNotes ?? "",
          warrantyNotes: settings.print.warrantyNotes ?? "",
          items: [],
        }}
      />
    </>
  );
}
