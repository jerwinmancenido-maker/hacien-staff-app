import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser, requireCostPage } from "@/lib/auth/current-user";
import { can, canSeeCosts } from "@/lib/permissions";
import { getPurchaseOrderPrint } from "@/lib/purchasing/views";
import { qrSvg } from "@/lib/print/qr";
import { missingCompanyDetails, PoPrintDocument } from "@/components/purchasing/PoPrintDocument";
import { PrintButton } from "@/components/docs/PrintButton";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || !canSeeCosts(user)) return { title: "Print" };
  const doc = await getPurchaseOrderPrint(id, user);
  // The browser uses the title as the default PDF file name.
  return { title: doc ? `${doc.number} ${doc.supplier.name}` : "Print" };
}

export default async function PrintPoPage({ params }: { params: Promise<{ id: string }> }) {
  // Cost data: only users with "Can see costs".
  const user = await requireCostPage("view");
  const { id } = await params;
  const doc = await getPurchaseOrderPrint(id, user);
  if (!doc) notFound();
  const missing = missingCompanyDetails(doc.company);
  return (
    <div className="print-shell">
      <div className="print-toolbar no-print">
        <Link className="btn btn-secondary" href={`/purchase-orders/${id}`}>
          Back
        </Link>
        <span className="small muted">Choose &quot;Save as PDF&quot; in the print dialog. Paper: A4.</span>
        <PrintButton />
      </div>
      {missing.length > 0 && (
        <div className="alert warn print-toolbar-alert no-print" role="status">
          <b>HACIEN&apos;s {missing.join(" and ")} {missing.length > 1 ? "are" : "is"} blank in Company settings.</b> The PO will print a placeholder
          until {missing.length > 1 ? "they are" : "it is"} filled in.{" "}
          {can(user, "manage_settings") ? <Link href="/settings?tab=company">Open Company settings</Link> : "Ask an admin to fill in Company settings."}
        </div>
      )}
      <PoPrintDocument doc={doc} qrSvg={await qrSvg()} />
    </div>
  );
}
