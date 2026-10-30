import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCostPage } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getReceivingReportPrintModel } from "@/lib/print/views";
import { PrintShell } from "@/components/docs/PrintShell";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Receiving report ${id.slice(0, 8)}` };
}

export default async function PrintReceivingReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireCostPage("view");
  const { id } = await params;
  const result = await getReceivingReportPrintModel(id, user);
  if (!result) notFound();
  return (
    <PrintShell
      backHref={`/receiving/${result.purchaseOrderId}`}
      doc={result.doc}
      missing={result.missing}
      canManageSettings={can(user, "manage_settings")}
    />
  );
}
