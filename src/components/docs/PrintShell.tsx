import Link from "next/link";
import { PrintButton } from "@/components/docs/PrintButton";
import { ProfessionalPrintDocument } from "@/components/docs/ProfessionalPrintDocument";
import type { ProfessionalPrintModel } from "@/lib/print/types";
import { missingCompanyWarning, missingFieldsPrintWarning } from "@/lib/print/company";

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
  const warning = missingFieldsPrintWarning(missing);

  return (
    <div className={`print-shell print-shell-${doc.paperSize.toLowerCase()}`}>
      <div className="print-toolbar no-print">
        <Link className="btn btn-secondary" href={backHref}>
          Back
        </Link>
        <span className="small muted">
          {doc.number} · Choose &quot;Save as PDF&quot; in the print dialog. Paper: {doc.paperSize}. Turn off
          browser headers and footers.
        </span>
        <PrintButton missing={missing} documentTitle={doc.number} />
      </div>
      {warning && (
        <aside className="tax-cal-notice print-toolbar-alert no-print" role="status">
          <p className="tax-cal-notice-line">
            {warning}{" "}
            {canManageSettings ? (
              <Link href="/settings?tab=print">Settings → Print &amp; company</Link>
            ) : (
              "Ask an admin to fill in Print & company details."
            )}
          </p>
        </aside>
      )}
      <ProfessionalPrintDocument doc={doc} />
    </div>
  );
}

/** Keep helper import used by Settings preview. */
export { missingCompanyWarning };
