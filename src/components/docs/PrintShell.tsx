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
  const hasMissing = missing.length > 0;

  return (
    <div className={`print-shell print-shell-${doc.paperSize.toLowerCase()}`}>
      <div className="print-toolbar no-print">
        <Link className="btn btn-secondary" href={backHref}>
          Back
        </Link>
        <span className="small muted">
          Choose &quot;Save as PDF&quot; in the print dialog. Paper: {doc.paperSize}.
        </span>
        <PrintButton missing={missing} />
      </div>
      {hasMissing && (
        <div className="alert warn print-toolbar-alert no-print" role="status">
          <b>TIN and address are missing. Print anyway?</b>{" "}
          {canManageSettings ? (
            <Link href="/settings?tab=print">Settings → Print &amp; company</Link>
          ) : (
            "Ask an admin to fill in Print & company details."
          )}
        </div>
      )}
      <ProfessionalPrintDocument doc={doc} />
    </div>
  );
}

/** Keep helper import used by Settings preview. */
export { missingCompanyWarning };
