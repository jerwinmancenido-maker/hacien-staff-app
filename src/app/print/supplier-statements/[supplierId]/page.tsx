import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCostPage } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getSupplierStatementPrintModel } from "@/lib/print/views";
import { PrintShell } from "@/components/docs/PrintShell";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ supplierId: string }> }): Promise<Metadata> {
  const { supplierId } = await params;
  return { title: `Supplier statement ${supplierId.slice(0, 8)}` };
}

export default async function PrintSupplierStatementPage({ params }: { params: Promise<{ supplierId: string }> }) {
  const user = await requireCostPage("view");
  const { supplierId } = await params;
  const result = await getSupplierStatementPrintModel(supplierId, user);
  if (!result) notFound();
  return (
    <PrintShell
      backHref={`/suppliers/${supplierId}?tab=balances`}
      doc={result.doc}
      missing={result.missing}
      canManageSettings={can(user, "manage_settings")}
    />
  );
}
