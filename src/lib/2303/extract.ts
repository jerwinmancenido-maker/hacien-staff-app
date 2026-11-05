// BIR 2303 text extraction (Claude 2303 parsing, step 1 — no AI yet).
// Digital PDFs are parsed directly; photos/scans go through local OCR
// (tesseract.js, WASM — no binary install, no paid service).
// A failure here never blocks creating the customer: callers show the
// error and staff types manually.

import path from "node:path";
import { mkdir } from "node:fs/promises";
import { PDFParse } from "pdf-parse";
import { createWorker } from "tesseract.js";
import { uploadDir } from "../business-docs/storage";

export type ExtractMime = "application/pdf" | "image/jpeg" | "image/png";
export type ExtractedText = { text: string; source: "pdf" | "ocr" };

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

async function extractPdf(bytes: Uint8Array): Promise<string> {
  const parser = new PDFParse({ data: bytes });
  try {
    const { text } = await parser.getText();
    return cleanPdfText(text);
  } catch {
    throw new Error("This PDF could not be read. It may be damaged — upload a photo instead, or type the details manually.");
  } finally {
    await parser.destroy();
  }
}

async function extractOcr(bytes: Uint8Array): Promise<string> {
  await mkdir(tessdataDir(), { recursive: true });
  // No langPath: the default jsDelivr CDN supplies eng.traineddata on
  // first use, and cachePath keeps it in the upload dir afterwards.
  const worker = await createWorker("eng", undefined, { cachePath: tessdataDir() });
  try {
    const { data } = await worker.recognize(Buffer.from(bytes));
    return data.text.trim();
  } finally {
    await worker.terminate();
  }
}

export async function extractText(bytes: Uint8Array, mime: ExtractMime): Promise<ExtractedText> {
  if (bytes.byteLength === 0) throw new Error("The file is empty.");
  if (mime === "application/pdf") {
    const text = await extractPdf(bytes);
    if (!text) throw new Error("No text could be read from this PDF. It may be a scanned image — upload a photo instead, or type the details manually.");
    return { text, source: "pdf" };
  }
  const text = await extractOcr(bytes);
  if (!text) throw new Error("No text could be read from this photo. Try a clearer, straighter photo, or type the details manually.");
  return { text, source: "ocr" };
}
