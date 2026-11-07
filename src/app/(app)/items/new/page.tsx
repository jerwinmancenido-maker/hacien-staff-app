import { requirePagePermission } from "@/lib/auth/current-user";
import { PageHeader } from "@/components/ui";
import { ItemForm } from "@/components/ItemForm";
import { saveItemAction } from "../actions";

export default async function NewItemPage() {
  await requirePagePermission("edit_data");
  return (
    <>
      <PageHeader title="New item" subtitle="Name, kind and unit are required. Brand, model, category, SKU, details and price are optional." />
      <div className="card">
        <ItemForm item={null} action={saveItemAction.bind(null, null)} canEdit />
      </div>
    </>
  );
}
