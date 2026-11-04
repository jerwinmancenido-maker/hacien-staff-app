import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { getAttachmentSheetModel } from "@/lib/print/attachment";
import { PrintButton } from "@/components/docs/PrintButton";
import { PackingListDocument } from "@/components/docs/PackingListDocument";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const sheet = await getAttachmentSheetModel(id);
  return { title: sheet ? `Packing list attachment DR ${sheet.drNumber}` : "Packing list attachment" };
}

/** S-64: packing list & delivery details attachment sheet for one delivery. Never a DR or SI. */
export default async function PrintAttachmentPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("view");
  const { id } = await params;
  const sheet = await getAttachmentSheetModel(id);
  if (!sheet) notFound();
  return (
    <div className="print-shell">
      <div className="print-toolbar no-print">
        <Link className="btn btn-secondary" href={`/sales-orders/${sheet.salesOrderId}`}>
          Back
        </Link>
        <span className="small muted">
          DR {sheet.drNumber} · Attachment only, not an official receipt or sales invoice. Choose &quot;Save as PDF&quot; in the print dialog.
        </span>
        <PrintButton documentTitle={`Packing list DR ${sheet.drNumber}`} />
      </div>
      <PackingListDocument sheet={sheet} />
    </div>
  );
}
