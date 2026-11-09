import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can, canSeeCosts } from "@/lib/permissions";
import { getItem } from "@/lib/services/items";
import { Chip, PageHeader } from "@/components/ui";
import { ConfirmAction } from "@/components/ConfirmAction";
import { ItemForm } from "@/components/ItemForm";
import { PillTabs } from "@/components/PillTabs";
import ItemHistoryDetail, { itemTabCounts } from "@/components/ItemHistoryDetail";
import { resolveItemTab } from "@/lib/items/tabs";
import { saveItemAction, setItemActiveAction } from "../actions";

/** Step 1: the edit form. Step 2 adds price history, suppliers and where-used.
 * Tabs (2026-11-08): the history sections live on their own tabs so the
 * page stays short no matter how long the item's history grows. */
export default async function ItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requirePagePermission("view");
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const item = await getItem(id);
  if (!item) notFound();
  const canEdit = can(user, "edit_data");
  const showCosts = canSeeCosts(user);
  let tab = resolveItemTab(rawTab);
  // The Suppliers tab exists only for roles that can see costs.
  if (tab === "suppliers" && !showCosts) tab = "details";
  const counts = await itemTabCounts(item.name, showCosts);

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
      <PillTabs
        active={tab}
        ariaLabel="Item sections"
        tabs={[
          { key: "details", label: "Details", href: `/items/${id}` },
          { key: "prices", label: "Price history", count: counts.prices, href: `/items/${id}?tab=prices` },
          ...(showCosts
            ? [{ key: "suppliers", label: "Suppliers", count: counts.suppliers, href: `/items/${id}?tab=suppliers` }]
            : []),
          { key: "used", label: "Where used", count: counts.used, href: `/items/${id}?tab=used` },
        ]}
      />
      {tab === "details" && (
        <div className="card">
          <ItemForm item={item} action={saveItemAction.bind(null, id)} canEdit={canEdit} />
        </div>
      )}
      <ItemHistoryDetail description={item.name} showCosts={showCosts} section={tab} />
    </>
  );
}
