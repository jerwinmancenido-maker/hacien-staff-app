import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { canSeeCosts } from "@/lib/permissions";
import ItemHistoryDetail from "@/components/ItemHistoryDetail";
import { PageHeader } from "@/components/ui";
import { SearchIcon } from "@/components/Icons";

/**
 * Step 2: history-only detail for a free-text description with no catalog
 * row yet — same sections as the catalog item detail, from the derived
 * document lines, without the edit form. Reached from the "From document
 * lines" tab; ?item= carries the description.
 */
export default async function ItemHistoryPage({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  const user = await requirePagePermission("view");
  const { item } = await searchParams;
  const description = (item ?? "").trim();
  const showCosts = canSeeCosts(user);

  return (
    <>
      <PageHeader
        title={description || "Item history"}
        subtitle={description ? "From document lines — no catalog item for this description yet." : "Price history, suppliers and where-used for one item description."}
      />
      <p>
        <Link className="btn secondary" href="/items?tab=history">
          ← Back to items
        </Link>
      </p>
      {!description ? (
        <>
          <form className="toolbar" method="get" role="search">
            <label className="sr-only" htmlFor="item">
              Item description
            </label>
            <span className="search-box">
              <SearchIcon />
              <input id="item" name="item" type="search" defaultValue="" placeholder="Type the item description exactly" />
            </span>
            <button className="btn secondary" type="submit">
              Show history
            </button>
          </form>
          <p className="faint">Type an item description, or follow a row from the Items page.</p>
        </>
      ) : (
        <ItemHistoryDetail description={description} showCosts={showCosts} />
      )}
    </>
  );
}
