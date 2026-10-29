import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { getQuotePrint } from "@/lib/quotes/views";
import { qrSvg } from "@/lib/print/qr";
import { PrintDocument } from "@/components/docs/PrintDocument";
import { PrintButton } from "@/components/docs/PrintButton";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const doc = await getQuotePrint(id);
  // The browser uses the title as the default PDF file name.
  return { title: doc ? `${doc.number} ${doc.customer.name}` : "Print" };
}

export default async function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  // Everyone who can view (including Viewers) can print.
  await requirePagePermission("view");
  const { id } = await params;
  const doc = await getQuotePrint(id);
  if (!doc) notFound();
  return (
    <div className="print-shell">
      <div className="print-toolbar no-print">
        <Link className="btn btn-secondary" href={`/quotes/${id}`}>
          Back
        </Link>
        <span className="small muted">Choose &quot;Save as PDF&quot; in the print dialog. Paper: A4.</span>
        <PrintButton />
      </div>
      <PrintDocument doc={doc} qrSvg={await qrSvg()} />
    </div>
  );
}
