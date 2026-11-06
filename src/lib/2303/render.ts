// Render PDF pages to PNG images (for scanned PDFs: no text layer).
// pdf.js draws each page onto an @napi-rs/canvas. Server-side only —
// the canvas is a native module, traced into the standalone server
// output for the parse route (see next.config.ts).
import "./dom-polyfill";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";

/** A 2303 is 3 pages; longer PDFs read only the first 3. */
export const MAX_RENDER_PAGES = 3;
/** 72dpi * 2.5 ≈ 180dpi — the photo OCR reads well at this density. */
const RENDER_SCALE = 2.5;

/**
 * Render the first pages of a PDF to PNG buffers. `workerSrc` is the
 * file URL of pdf.worker.mjs (resolved by the caller the same way the
 * text reader resolves it — the bundled default path does not exist).
 */
export async function renderPdfPages(bytes: Uint8Array, workerSrc: string, maxPages = MAX_RENDER_PAGES): Promise<Buffer[]> {
  GlobalWorkerOptions.workerSrc = workerSrc;
  // pdf.js rejects a Node Buffer — normalize to a plain Uint8Array.
  const doc = await getDocument({ data: Uint8Array.from(bytes) }).promise;
  try {
    const pages: Buffer[] = [];
    const count = Math.min(doc.numPages, maxPages);
    for (let n = 1; n <= count; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
      // canvas: null + canvasContext is pdf.js's documented path for
      // rendering with a context directly (no DOM canvas element).
      await page.render({ canvas: null, canvasContext: ctx, viewport }).promise;
      pages.push(await canvas.encode("png"));
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}
