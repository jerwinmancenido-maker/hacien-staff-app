import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getCustomerStatementPrintModel } from "@/lib/print/views";
import { PrintShell } from "@/components/docs/PrintShell";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ customerId: string }> }): Promise<Metadata> {
  const { customerId } = await params;
  const result = await getCustomerStatementPrintModel(customerId);
  return { title: result ? `Statement ${result.doc.party.name}` : "Statement" };
}

export default async function PrintStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requirePagePermission("view");
  const { customerId } = await params;
  const sp = await searchParams;
  const from = sp.from ? new Date(`${sp.from}T00:00:00.000Z`) : null;
  const to = sp.to ? new Date(`${sp.to}T00:00:00.000Z`) : null;
  const result = await getCustomerStatementPrintModel(customerId, from, to);
  if (!result) notFound();
  return (
    <PrintShell
      backHref={`/customers/${customerId}?tab=balances`}
      doc={result.doc}
      missing={result.missing}
      canManageSettings={can(user, "manage_settings")}
    />
  );
}
