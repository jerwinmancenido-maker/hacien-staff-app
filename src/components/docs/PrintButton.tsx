"use client";

import { missingFieldsPrintConfirm } from "@/lib/print/company";

/**
 * Screen-only Print / Save PDF.
 * - Sets a clean document title for the PDF filename when provided.
 * - When company TIN/address are missing, confirm before printing (main).
 */
export function PrintButton({
  missing,
  documentTitle,
}: {
  missing?: string[];
  documentTitle?: string;
}) {
  return (
    <button
      type="button"
      className="btn no-print"
      onClick={() => {
        const confirmMsg = missingFieldsPrintConfirm(missing ?? []);
        if (confirmMsg) {
          const ok = window.confirm(confirmMsg);
          if (!ok) return;
        }
        if (documentTitle?.trim()) {
          const previous = document.title;
          document.title = documentTitle.trim();
          const restore = () => {
            document.title = previous;
            window.removeEventListener("afterprint", restore);
          };
          window.addEventListener("afterprint", restore);
        }
        window.print();
      }}
    >
      Print / Save PDF
    </button>
  );
}
