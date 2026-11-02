import { requirePagePermission } from "@/lib/auth/current-user";
import { getSettingsSnapshot } from "@/lib/settings";
import { listWithholdingRates, toSnapshot } from "@/lib/services/withholding";
import { allowGovVatOption, WITHHOLDING_DEFAULT_CODES } from "@/lib/quotes/withholding-defaults";
import { getCustomer } from "@/lib/services/companies";
import { listAddresses } from "@/lib/services/addresses";
import { PageHeader } from "@/components/ui";
import { CustomerForm } from "../CustomerForm";
import { saveCustomerAction } from "../actions";

export default async function NewCustomerPage({
  searchParams,
}: {
  searchParams?: Promise<{ copy?: string }>;
}) {
  await requirePagePermission("edit_data");
  const { settings } = await getSettingsSnapshot();
  const rates = (await listWithholdingRates(undefined, { activeOnly: true })).map(toSnapshot);
  const visible = allowGovVatOption() ? rates : rates.filter((r) => r.code !== WITHHOLDING_DEFAULT_CODES.GOV_VAT_5);
  const sp = searchParams ? await searchParams : undefined;
  const original = sp?.copy ? await getCustomer(sp.copy) : null;
  const addresses = original ? await listAddresses({ kind: "customer", id: original.id }) : [];
  const initialCustomer = original
    ? {
        ...original,
        name: `${original.name} (copy)`,
        tin: null,
      }
    : null;

  return (
    <>
      <PageHeader
        title={original ? `Duplicate: ${original.name}` : "New customer"}
        subtitle="Name and customer type are required. Withholding rates are picked below."
      />
      <div className="card" style={{ maxWidth: 760 }}>
        <CustomerForm
          customer={initialCustomer}
          terms={settings.lists.paymentTerms}
          rates={visible}
          action={saveCustomerAction.bind(null, null)}
          canEdit
          addresses={addresses}
        />
      </div>
    </>
  );
}
