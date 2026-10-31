"use client";

import { missingFieldsPrintConfirm } from "@/lib/print/company";

/** Print / Save PDF. When company TIN/address are missing, confirm before printing. */
export function PrintButton({ missing }: { missing?: string[] }) {
  return (
    <button
      type="button"
      className="btn"
      onClick={() => {
        const confirmMsg = missingFieldsPrintConfirm(missing ?? []);
        if (confirmMsg) {
          const ok = window.confirm(confirmMsg);
          if (!ok) return;
        }
        window.print();
      }}
    >
      Print / Save PDF
    </button>
  );
}
