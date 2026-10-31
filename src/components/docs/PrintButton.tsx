"use client";

/** Screen-only print trigger. Sets a clean document title for the PDF filename. */
export function PrintButton({ documentTitle }: { documentTitle?: string }) {
  return (
    <button
      type="button"
      className="btn no-print"
      onClick={() => {
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
