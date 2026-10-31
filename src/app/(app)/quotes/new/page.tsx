import { requirePagePermission } from "@/lib/auth/current-user";
import { getSettingsSnapshot } from "@/lib/settings";
import { addDays, isoDate, manilaToday } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { DocumentEditor } from "@/components/docs/DocumentEditor";
import { documentWithholdingFromCustomer, allowGovVatOption } from "@/lib/quotes/withholding-defaults";
import { editorCustomers, editorRates, editorSuppliers } from "../editor-data";
import { saveQuoteAction } from "../actions";

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const user = await requirePagePermission("edit_data");
  const { customer: customerParam } = await searchParams;
  const { settings } = await getSettingsSnapshot();
  const [customers, rates, suppliers] = await Promise.all([editorCustomers(), editorRates(), editorSuppliers(user)]);
  const today = manilaToday();
  const preset = customers.find((c) => c.id === customerParam);
  const withholdingCodes = preset
    ? documentWithholdingFromCustomer(preset.withholdingType, ["GOODS", "SERVICES"], {
        includeGovVat: false,
        businessIsVatRegistered: allowGovVatOption(),
      }).map((w) => w.code)
    : [];

  return (
    <>
      <PageHeader title="New quote" subtitle="Pick the customer, add the lines, and save. The quote number is given on save." />
      <DocumentEditor
        mode="quote"
        isNew
        customers={customers}
        rates={rates}
        suppliers={suppliers}
        termsOptions={settings.lists.paymentTerms}
        action={saveQuoteAction.bind(null, null)}
        cancelHref="/quotes"
        initial={{
          customerId: preset?.id ?? "",
          contactId: preset?.contacts.find((c) => c.isMain)?.id ?? "",
          date: isoDate(today),
          validUntil: isoDate(addDays(today, settings.quotes.defaultValidityDays)),
          terms: preset?.defaultTerms ?? "",
          notes: "",
          withholdingCodes,
          buyerPoNo: "",
          buyerPoDate: "",
          deliveryAddress: "",
          items: [],
        }}
      />
    </>
  );
}
