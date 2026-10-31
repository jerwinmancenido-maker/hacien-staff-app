import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser, requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getSalesOrderPrintModel } from "@/lib/print/views";
import { PrintShell } from "@/components/docs/PrintShell";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const result = await getSalesOrderPrintModel(id);
  return { title: result ? result.doc.number : "Print" };
}

export default async function PrintSalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("view");
  const user = await getCurrentUser();
  const { id } = await params;
  const result = await getSalesOrderPrintModel(id);
  if (!result) notFound();
  return (
    <PrintShell
      backHref={`/sales-orders/${id}`}
      doc={result.doc}
      missing={result.missing}
      canManageSettings={!!user && can(user, "manage_settings")}
    />
  );
}
