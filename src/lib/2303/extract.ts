// BIR 2303 text extraction (Claude 2303 parsing, step 1 — no AI yet).
// Digital PDFs are parsed directly; photos/scans go through local OCR
// (tesseract.js, WASM — no binary install, no paid service).
// A failure here never blocks creating the customer: callers show the
// error and staff types manually.

import "./dom-polyfill";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import { PDFParse } from "pdf-parse";
import { createWorker } from "tesseract.js";
import { uploadDir } from "../business-docs/storage";

/**
 * Find a file or directory that ships inside an installed package,
 * wherever the host put node_modules.
 *
 * Both extraction libraries run their real work in a worker file, and
 * both compute that file's path in a way that breaks inside the Next.js
 * server bundle: pdf.js looks for `pdf.worker.mjs` under
 * `.next/server/chunks` (it is not there), and tesseract.js resolves its
 * worker script against a bundled `__dirname` of `/ROOT` (also not
 * there). `process.cwd()` is no anchor either — Hostinger runs each
 * build from a versioned directory
 * (`.../hbuilds/versions/<build>/nodejs`), while node_modules lives
 * further up the tree. So start at this module's real file location
 * (the bundle chunk on the server, the source file under vitest) and
 * walk up until `node_modules/<package>/...` exists — the same search
 * Node's own resolver does. A runtime-built `require.resolve` is NOT
 * used: Turbopack rejects it ("expression is too dynamic").
 */
function findInstalledPath(...parts: string[]): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = path.join(dir, "node_modules", ...parts);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Missing file in the app install: node_modules/${parts.join("/")}`);
    dir = parent;
  }
}

/** Fail fast instead of hanging until the host kills the request. */
function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  // Clear the timer when the race settles — not when this function
  // returns, or the timeout would be cancelled immediately.
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export type ExtractMime = "application/pdf" | "image/jpeg" | "image/png";
export type ExtractedText = { text: string; source: "pdf" | "ocr" | "pdf-ocr" };

/** pdf-parse appends a "-- N of N --" marker after each page; drop those lines. */
export function cleanPdfText(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^-- \d+ of \d+ --$/.test(line.trim()))
    .join("\n")
    .trim();
}

/**
 * Where tesseract keeps its downloaded language data. The library default
 * is the process working directory — the app must not rely on that (the
 * app directory is replaced on deploy). First OCR on a server downloads
 * ~5 MB once into this cache, then reuses it.
 */
export function tessdataDir(dir: string = uploadDir()): string {
  return path.join(dir, "tessdata");
}

async function extractPdf(bytes: Uint8Array, pdfWorkerSrc: string): Promise<string> {
  // workerSrc: pdf.js's fake worker loads this file with a native dynamic
  // import. Its bundled default points into .next/server/chunks, where
  // the file does not exist ("Setting up fake worker failed"). Set it
  // once per call (it is global state in pdf.js, idempotent).
  PDFParse.setWorker(pdfWorkerSrc);
  const parser = new PDFParse({ data: bytes });
  try {
    const { text } = await parser.getText();
    return cleanPdfText(text);
  } catch (e) {
    // Keep the underlying cause: on staging the PDF read failed for a
    // server reason, not a damaged file, and the cause is what fixes it.
    const cause = e instanceof Error ? e.message : "Unknown error.";
    throw new Error(`This PDF could not be read (${cause}). It may be damaged — upload a photo instead, or type the details manually.`);
  } finally {
    await parser.destroy();
  }
}

/** The OCR worker, with the same path fixes as the photo read. */
async function createOcrWorker() {
  await mkdir(tessdataDir(), { recursive: true });
  // workerPath: tesseract's node default resolves its worker script
  // against a bundled `__dirname` of `/ROOT`, so the worker never starts
  // and the request hangs until the host kills it. Point at the real
  // file. langPath: the English traineddata ships in the
  // @tesseract.js-data/eng package (installed with the app), so the
  // first photo read does not need the library's CDN at all — the
  // worker reads eng.traineddata.gz from disk and caches the unpacked
  // file under tessdataDir(). The 60s cap keeps a stuck read a readable
  // error instead of a hang.
  const workerPath = findInstalledPath("tesseract.js", "src", "worker-script", "node", "index.js");
  const langPath = findInstalledPath("@tesseract.js-data", "eng", "4.0.0");
  // Two separate caps with distinct messages: on staging the photo read
  // times out, and the stage that timed out is the diagnosis (worker
  // that never starts vs a read that never finishes).
  return withTimeout(
    createWorker("eng", undefined, { cachePath: tessdataDir(), workerPath, langPath }),
    25_000,
    "The photo reader did not start. Type the details manually.",
  );
}

async function recognizePage(worker: Awaited<ReturnType<typeof createWorker>>, bytes: Uint8Array): Promise<string> {
  const { data } = await withTimeout(
    worker.recognize(Buffer.from(bytes)),
    60_000,
    "The photo reader started but did not finish reading. Type the details manually.",
  );
  return data.text.trim();
}

async function extractOcr(bytes: Uint8Array): Promise<string> {
  const worker = await createOcrWorker();
  try {
    return await recognizePage(worker, bytes);
  } finally {
    await worker.terminate();
  }
}

/**
 * Scanned PDF: no text layer, so the text read came back empty. Render
 * the first pages to images and OCR them with the photo reader. Any
 * failure here returns "" — the caller reports the same "upload a photo
 * instead" message as before, so a scanned PDF that still can't be read
 * behaves exactly as it did before this fallback existed.
 */
async function extractScannedPdf(bytes: Uint8Array, pdfWorkerSrc: string): Promise<string> {
  const { renderPdfPages } = await import("./render");
  try {
    const pages = await withTimeout(renderPdfPages(bytes, pdfWorkerSrc), 60_000, "render timeout");
    if (pages.length === 0) return "";
    const worker = await createOcrWorker();
    try {
      const texts: string[] = [];
      for (const page of pages) {
        texts.push(await recognizePage(worker, new Uint8Array(page)));
      }
      return texts.filter(Boolean).join("\n\n");
    } finally {
      await worker.terminate();
    }
  } catch {
    return "";
  }
}

export async function extractText(bytes: Uint8Array, mime: ExtractMime): Promise<ExtractedText> {
  // pdf.js rejects a Node Buffer outright ("provide binary data as
  // `Uint8Array`, rather than `Buffer`") — and readFile / the upload
  // path hand us Buffers. Normalize once: a plain Uint8Array works
  // everywhere below (pdf-parse, pdf.js, tesseract).
  const data = Uint8Array.from(bytes);
  if (data.byteLength === 0) throw new Error("The file is empty.");
  if (mime === "application/pdf") {
    const pdfWorkerSrc = pathToFileURL(findInstalledPath("pdfjs-dist", "legacy", "build", "pdf.worker.mjs")).href;
    const text = await extractPdf(data, pdfWorkerSrc);
    if (text) return { text, source: "pdf" };
    // No text layer — a scanned PDF. Render the pages and OCR them.
    // Pass the ORIGINAL bytes: the text read above transfers (detaches)
    // `data`'s ArrayBuffer to the pdf.js worker, so `data` is unusable now.
    const scanned = await extractScannedPdf(bytes, pdfWorkerSrc);
    if (scanned) return { text: scanned, source: "pdf-ocr" };
    throw new Error("No text could be read from this PDF. It may be a scanned image — upload a photo instead, or type the details manually.");
  }
  const text = await extractOcr(data);
  if (!text) throw new Error("No text could be read from this photo. Try a clearer, straighter photo, or type the details manually.");
  return { text, source: "ocr" };
}
