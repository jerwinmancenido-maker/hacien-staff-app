import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatSiNumbers, splitSerials } from "@/lib/print/attachment";

const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), "utf8");

describe("S-64 attachment sheet", () => {
  it("splits comma-separated serials and drops blanks", () => {
    expect(splitSerials("SN-1, SN-2,, SN-3")).toEqual(["SN-1", "SN-2", "SN-3"]);
    expect(splitSerials(null)).toEqual([]);
    expect(splitSerials("")).toEqual([]);
  });

  it("formats linked SI numbers, blank when none yet", () => {
    expect(formatSiNumbers(["123", "124"])).toBe("123, 124");
    expect(formatSiNumbers([])).toBe("___");
    expect(formatSiNumbers(["  ", ""])).toBe("___");
  });

  it("is titled as an attachment, never a DR or SI, with both disclaimer lines", () => {
    const doc = src("src/components/docs/PackingListDocument.tsx");
    expect(doc).toContain("PACKING LIST &amp; DELIVERY DETAILS");
    expect(doc).toContain("(Attachment to DR No.");
    expect(doc).toContain("ATTACHMENT ONLY — NOT AN OFFICIAL RECEIPT OR SALES INVOICE.");
    expect(doc).toContain("THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.");
    expect(doc).toContain("Computer-generated. Always issued with the manual BIR DR/SI.");
    expect(doc).toContain("policiesUrl");
    expect(doc).toContain("versionLine");
  });

  it("warranty falls back from the quote to Settings, and banks use print rules", () => {
    const model = src("src/lib/print/attachment.ts");
    expect(model).toContain("so.quote.warrantyNotes?.trim() || settings.print.warrantyNotes?.trim() || null");
    expect(model).toContain("paymentInstructionsFromSettings");
  });

  it("the SO page links each delivery to its attachment print", () => {
    expect(src("src/components/sales-orders/DeliverySection.tsx")).toContain("/print/deliveries/${d.id}/attachment");
    expect(src("src/app/print/deliveries/[id]/attachment/page.tsx")).toContain("getAttachmentSheetModel");
  });

  it("serials ride on S-48's copied migration (merge S-48 first at sync)", () => {
    const migration = src("prisma/migrations/20261104200000_s48_serial_numbers/migration.sql");
    expect(migration).toContain("ADD COLUMN `serialNumbers` TEXT NULL");
    expect(src("prisma/schema.prisma")).toContain("serialNumbers");
  });
});
