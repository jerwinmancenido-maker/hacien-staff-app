import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can, canSeeCosts } from "@/lib/permissions";
import { getItem } from "@/lib/services/items";
import { Chip, PageHeader } from "@/components/ui";
import { ConfirmAction } from "@/components/ConfirmAction";
import { ItemForm } from "@/components/ItemForm";
import ItemHistoryDetail from "@/components/ItemHistoryDetail";
import { saveItemAction, setItemActiveAction } from "../actions";

/** Step 1: the edit form. Step 2 adds price history, suppliers and where-used below it. */
export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("view");
  const { id } = await params;
  const item = await getItem(id);
  if (!item) notFound();
  const canEdit = can(user, "edit_data");
  const showCosts = canSeeCosts(user);

  return (
    <>
      <PageHeader
        title={item.name}
        subtitle={[item.brand, item.model, item.category].filter(Boolean).join(" · ") || "Catalog item"}
        actions={
          canEdit &&
          (item.active ? (
            <ConfirmAction
              action={setItemActiveAction.bind(null, id, false)}
              label="Mark inactive"
              title="Mark inactive?"
              body="It can't be picked on new quotes. History stays."
              danger
            />
          ) : (
            <ConfirmAction
              action={setItemActiveAction.bind(null, id, true)}
              label="Mark active"
              title="Mark active?"
              body="It can be picked on new quotes again."
            />
          ))
        }
      />
      <p>
        {!item.active && <Chip tone="red">Inactive</Chip>}{" "}
        <Link className="btn secondary" href="/items">
          ← Back to items
        </Link>
      </p>
      <div className="card">
        <ItemForm item={item} action={saveItemAction.bind(null, id)} canEdit={canEdit} />
      </div>
      <ItemHistoryDetail description={item.name} showCosts={showCosts} />
    </>
  );
}
