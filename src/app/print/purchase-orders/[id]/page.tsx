import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser, requireCostPage } from "@/lib/auth/current-user";
import { canSeeCosts } from "@/lib/permissions";
import { getPurchaseOrderPrint } from "@/lib/purchasing/views";
import { qrSvg } from "@/lib/print/qr";
import { PoPrintDocument } from "@/components/purchasing/PoPrintDocument";
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
  return (
    <div className="print-shell">
      <div className="print-toolbar no-print">
        <Link className="btn btn-secondary" href={`/purchase-orders/${id}`}>
          Back
        </Link>
        <span className="small muted">Choose &quot;Save as PDF&quot; in the print dialog. Paper: A4.</span>
        <PrintButton />
      </div>
      <PoPrintDocument doc={doc} qrSvg={await qrSvg()} />
    </div>
  );
}
