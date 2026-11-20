import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { isItemsImportEnabled } from "@/lib/items/import-enabled";
import { PageHeader } from "@/components/ui";
import { ItemsImportForm } from "@/components/ItemsImportForm";
import { importItemsAction } from "./actions";

/**
 * Phase 4 #4: CSV import for the item catalog. edit_data-gated (same as
 * item create) and flag-gated: with itemsImportEnabled off this page
 * explains instead of offering the upload, and the actions refuse too.
 */
export default async function ImportItemsPage() {
  await requirePagePermission("edit_data");

  if (!(await isItemsImportEnabled())) {
    return (
      <>
        <PageHeader title="Import items" subtitle="Turned off" />
        <div className="card">
          <p>CSV import is turned off. Ask your admin to turn it on in Settings → Features.</p>
          <p className="faint small" style={{ marginTop: 12 }}>
            <Link href="/items">Back to items</Link>
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Import items"
        subtitle="Add many catalog items at once from a .csv file — preview first, then confirm. All rows are created together, or none."
      />
      <ItemsImportForm action={importItemsAction} />
    </>
  );
}
