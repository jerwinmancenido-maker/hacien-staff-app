import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser, requireCostPage } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getPurchaseOrderPrintModel } from "@/lib/print/views";
import { PrintShell } from "@/components/docs/PrintShell";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return { title: "Print" };
  try {
    const result = await getPurchaseOrderPrintModel(id, user);
    return { title: result ? `${result.doc.number} ${result.doc.party.name}` : "Print" };
  } catch {
    return { title: "Print" };
  }
}

export default async function PrintPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireCostPage("view");
  const { id } = await params;
  const result = await getPurchaseOrderPrintModel(id, user);
  if (!result) notFound();
  return (
    <PrintShell
      backHref={`/purchase-orders/${id}`}
      doc={result.doc}
      missing={result.missing}
      canManageSettings={can(user, "manage_settings")}
    />
  );
}
