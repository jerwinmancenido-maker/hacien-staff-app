import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCostPage } from "@/lib/auth/current-user";
import { can, canSeeTin } from "@/lib/permissions";
import { getSupplierStatementPrintModel } from "@/lib/print/views";
import { PrintShell } from "@/components/docs/PrintShell";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ supplierId: string }> }): Promise<Metadata> {
  const { supplierId } = await params;
  return { title: `Supplier statement ${supplierId.slice(0, 8)}` };
}

export default async function PrintSupplierStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ supplierId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requireCostPage("view");
  const { supplierId } = await params;
  const sp = await searchParams;
  const from = sp.from ? new Date(`${sp.from}T00:00:00.000Z`) : null;
  const to = sp.to ? new Date(`${sp.to}T00:00:00.000Z`) : null;
  const result = await getSupplierStatementPrintModel(supplierId, user, from, to);
  if (!result) notFound();
  const backQs = [sp.from ? `from=${sp.from}` : null, sp.to ? `to=${sp.to}` : null].filter(Boolean).join("&");
  return (
    <PrintShell
      backHref={`/suppliers/${supplierId}?tab=balances${backQs ? `&${backQs}` : ""}`}
      doc={result.doc}
      missing={result.missing}
      canManageSettings={can(user, "manage_settings")}
      hideCounterpartyTin={!canSeeTin(user)}
    />
  );
}
