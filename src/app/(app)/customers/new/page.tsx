import { requirePagePermission } from "@/lib/auth/current-user";
import { getSettingsSnapshot } from "@/lib/settings";
import { listWithholdingRates, toSnapshot } from "@/lib/services/withholding";
import { allowGovVatOption, WITHHOLDING_DEFAULT_CODES } from "@/lib/quotes/withholding-defaults";
import { PageHeader } from "@/components/ui";
import { CustomerForm } from "../CustomerForm";
import { saveCustomerAction } from "../actions";

export default async function NewCustomerPage() {
  await requirePagePermission("edit_data");
  const { settings } = await getSettingsSnapshot();
  const rates = (await listWithholdingRates(undefined, { activeOnly: true })).map(toSnapshot);
  const visible = allowGovVatOption() ? rates : rates.filter((r) => r.code !== WITHHOLDING_DEFAULT_CODES.GOV_VAT_5);
  return (
    <>
      <PageHeader title="New customer" subtitle="Name and customer type are required. Withholding rates are picked below." />
      <div className="card" style={{ maxWidth: 760 }}>
        <CustomerForm
          customer={null}
          terms={settings.lists.paymentTerms}
          rates={visible}
          action={saveCustomerAction.bind(null, null)}
          canEdit
        />
      </div>
    </>
  );
}
