import { requirePagePermission } from "@/lib/auth/current-user";
import { getSettingsSnapshot } from "@/lib/settings";
import { PageHeader } from "@/components/ui";
import { SupplierForm } from "../SupplierForm";
import { saveSupplierAction } from "../actions";

export default async function NewSupplierPage() {
  await requirePagePermission("edit_data");
  const { settings } = await getSettingsSnapshot();
  return (
    <>
      <PageHeader title="New supplier" subtitle="Name is required. Add UnionBank details before paying." />
      <div className="card" style={{ maxWidth: 760 }}>
        <SupplierForm supplier={null} terms={settings.lists.paymentTerms} action={saveSupplierAction.bind(null, null)} canEdit />
      </div>
    </>
  );
}
