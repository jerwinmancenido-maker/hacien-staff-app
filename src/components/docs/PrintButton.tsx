"use client";

/** Print / Save PDF. When company TIN/address are missing, confirm before printing. */
export function PrintButton({ missing }: { missing?: string[] }) {
  return (
    <button
      type="button"
      className="btn"
      onClick={() => {
        if (missing && missing.length > 0) {
          const ok = window.confirm("TIN and address are missing. Print anyway?");
          if (!ok) return;
        }
        window.print();
      }}
    >
      Print / Save PDF
    </button>
  );
}
