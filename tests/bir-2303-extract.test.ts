// BIR 2303 text extraction (step 1, no AI): PDF text + photo OCR.
// Fixtures are fake 2303 data generated locally, never a real document.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanPdfText, extractText } from "@/lib/2303/extract";

const fixture = (name: string) => readFileSync(join(process.cwd(), "tests", "fixtures", name));
const fixturePng = () => Buffer.from(readFileSync(join(process.cwd(), "tests", "fixtures", "2303-sample.png.b64"), "utf8").replace(/\s/g, ""), "base64");

describe("cleanPdfText", () => {
  it("drops pdf-parse page markers and trims", () => {
    expect(cleanPdfText("TIN: 123\n-- 1 of 1 --\n\n")).toBe("TIN: 123");
    expect(cleanPdfText("-- 2 of 3 --\nName: X\n-- 3 of 3 --")).toBe("Name: X");
  });
});

describe("extractText", () => {
  it("reads text from a digital PDF", async () => {
    const { text, source } = await extractText(fixture("2303-sample.pdf"), "application/pdf");
    expect(source).toBe("pdf");
    expect(text).toContain("REPUBLIC OF THE PHILIPPINES");
    expect(text).toContain("Registered Name: HACIEN INFORMATION TECHNOLOGY SOLUTIONS");
    expect(text).toContain("TIN: 123-456-789-000");
    expect(text).not.toContain("-- 1 of 1 --");
  });

  it("reads text from a photo with OCR", async () => {
    const { text, source } = await extractText(fixturePng(), "image/png");
    expect(source).toBe("ocr");
    expect(text).toContain("REPUBLIC OF THE PHILIPPINES");
    expect(text).toContain("TIN: 123-456-789-000");
  }, 120_000);

  it("rejects an empty file", async () => {
    await expect(extractText(new Uint8Array(), "application/pdf")).rejects.toThrow(/empty/);
  });

  it("rejects a PDF that can't be read", async () => {
    // A valid PDF header but no content: pdf-parse cannot parse it.
    const bytes = new TextEncoder().encode("%PDF-1.4\n%%EOF");
    await expect(extractText(bytes, "application/pdf")).rejects.toThrow(/could not be read/);
  });
});

describe("extractText on a scanned PDF", () => {
  it("renders the pages and OCRs them (first 3 pages only)", async () => {
    // The fixture is stored base64 (push-files rejects binary files).
    const pdf = Buffer.from(
      readFileSync(join(process.cwd(), "tests", "fixtures", "2303-scanned-sample.pdf.b64"), "utf8").replace(/\s/g, ""),
      "base64",
    );
    const { text, source } = await extractText(new Uint8Array(pdf), "application/pdf");
    expect(source).toBe("pdf-ocr");
    expect(text).toContain("FAKE SCANNED 2303 PAGE ONE");
    expect(text).toContain("FAKE SCANNED COMPANY");
    expect(text).toContain("111-222-333-000");
    expect(text).toContain("FAKE SCANNED 2303 PAGE TWO");
    expect(text).toContain("FAKE SCANNED 2303 PAGE THREE");
    expect(text).not.toContain("PAGE FOUR");
    expect(text).not.toContain("SHOULD NOT BE READ");
  }, 180_000);
});
