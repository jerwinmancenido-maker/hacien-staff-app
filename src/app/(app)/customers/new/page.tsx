import { requirePagePermission } from "@/lib/auth/current-user";
import { getSettingsSnapshot } from "@/lib/settings";
import { listWithholdingRates } from "@/lib/services/withholding";
import { PageHeader } from "@/components/ui";
import { CustomerForm } from "../CustomerForm";
import { saveCustomerAction } from "../actions";

export default async function NewCustomerPage() {
  await requirePagePermission("edit_data");
  const { settings } = await getSettingsSnapshot();
  const rates = (await listWithholdingRates()).map((r) => ({ code: r.code, label: r.label, active: r.active }));
  return (
    <>
      <PageHeader title="New customer" subtitle="Name and withholding type are required." />
      <div className="card" style={{ maxWidth: 760 }}>
        <CustomerForm customer={null} terms={settings.lists.paymentTerms} rates={rates} action={saveCustomerAction.bind(null, null)} canEdit />
      </div>
    </>
  );
}
