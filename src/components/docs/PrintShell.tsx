import Link from "next/link";
import { PrintButton } from "@/components/docs/PrintButton";
import { ProfessionalPrintDocument } from "@/components/docs/ProfessionalPrintDocument";
import type { ProfessionalPrintModel } from "@/lib/print/types";
import { missingCompanyWarning } from "@/lib/print/company";

export function PrintShell({
  backHref,
  doc,
  missing,
  canManageSettings,
}: {
  backHref: string;
  doc: ProfessionalPrintModel;
  missing: string[];
  canManageSettings?: boolean;
}) {
  const warning =
    missing.length > 0
      ? missing.includes("TIN") && missing.length === 1
        ? "Add your TIN so it prints on documents."
        : `Add your ${missing.join(" and ")} so ${missing.length > 1 ? "they" : "it"} print${missing.length > 1 ? "" : "s"} on documents.`
      : null;

  return (
    <div className={`print-shell print-shell-${doc.paperSize.toLowerCase()}`}>
      <div className="print-toolbar no-print">
        <Link className="btn btn-secondary" href={backHref}>
          Back
        </Link>
        <span className="small muted">
          {doc.number} · {doc.status} · Choose &quot;Save as PDF&quot; in the print dialog. Paper: {doc.paperSize}. Turn off
          browser headers and footers.
        </span>
        <PrintButton documentTitle={doc.number} />
      </div>
      {warning && (
        <div className="alert warn print-toolbar-alert no-print" role="status">
          <b>{warning}</b>{" "}
          {canManageSettings ? <Link href="/settings?tab=print">Open Print &amp; company details</Link> : "Ask an admin to fill in Print & company details."}
        </div>
      )}
      <ProfessionalPrintDocument doc={doc} />
    </div>
  );
}

/** Keep helper import used by Settings preview. */
export { missingCompanyWarning };
