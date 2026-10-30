import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getCollectionPrintModel } from "@/lib/print/views";
import { PrintShell } from "@/components/docs/PrintShell";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const result = await getCollectionPrintModel(id);
  return { title: result ? `${result.doc.number} ${result.doc.party.name}` : "Print collection" };
}

export default async function PrintCollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("view");
  const { id } = await params;
  const result = await getCollectionPrintModel(id);
  if (!result) notFound();
  return (
    <PrintShell
      backHref={`/billing/collections/${id}`}
      doc={result.doc}
      missing={result.missing}
      canManageSettings={can(user, "manage_settings")}
    />
  );
}
