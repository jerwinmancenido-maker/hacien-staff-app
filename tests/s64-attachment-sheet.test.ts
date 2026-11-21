import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatSiNumbers, splitSerials, type AttachmentSheet } from "@/lib/print/attachment";
import { PackingListDocument } from "@/components/docs/PackingListDocument";

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
    // The title stacks in two lines since the 2026-11-09 redesign mock v2
    // ("Packing List" + "& Delivery Details"); together they are the title.
    expect(doc).toContain("Packing List");
    expect(doc).toContain("&amp; Delivery Details");
    expect(doc).toContain("Attachment to DR No.");
    expect(doc).toContain("ATTACHMENT ONLY — NOT AN OFFICIAL RECEIPT OR SALES INVOICE.");
    expect(doc).toContain("THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.");
    expect(doc).toContain("Computer-generated. Always issued with the manual BIR DR/SI.");
    // The policies URL prints once, inside the version line — the bare
    // policiesUrl line duplicated it (owner-approved redesign 2026-11-09,
    // the same dedup rule the professional documents follow since v8).
    expect(doc).not.toContain("sheet.policiesUrl");
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

// VR1 D16/D17/D22: the packing list showed a lot as one opaque row, had
// no contact person or phone for the driver, and printed quantities
// with decimals ("2.00 pc").
describe("S-64 attachment sheet — lot parts, contact, whole quantities", () => {
  const model = src("src/lib/print/attachment.ts");

  it("loads lot components with the description + qty + unit only select", () => {
    expect(model).toContain("components: {");
    expect(model).toContain("select: { description: true, qty: true, unit: true }");
    // Supplier and cost must never reach this sheet.
    expect(model).not.toContain("unitCost");
    expect(model).not.toContain("supplierId");
  });

  it("loads the sales order's contact name and phone", () => {
    expect(model).toContain("contact: { select: { name: true, phone: true } }");
    expect(model).toContain("contactName: so.contact?.name ?? null");
    expect(model).toContain("contactPhone: so.contact?.phone ?? null");
  });

  it("strips the trailing .00 from whole quantities", () => {
    expect(model).toContain('replace(/\\.00$/, "")');
  });

  function sheetFixture(overrides: Partial<AttachmentSheet> = {}): AttachmentSheet {
    return {
      deliveryId: "del-1",
      salesOrderId: "so-1",
      salesOrderNumber: "SO-2026-0001",
      drNumber: "10452",
      siNumbers: "10",
      deliveryDate: "November 21, 2026",
      receivedBy: "Juan Dela Cruz",
      customerName: "Acme Corporation",
      customerAddress: "123 Gate Street, Pasig",
      contactName: "Maria Santos",
      contactPhone: "0917 123 4567",
      items: [
        {
          description: "ICT Bundle",
          qty: "1 lot",
          serials: [],
          note: null,
          isLot: true,
          parts: [
            { description: "Laptop unit", qty: "2 pc" },
            { description: "Docking station", qty: "1.50 pc" },
          ],
        },
        { description: "HDMI cable", qty: "3 pc", serials: ["SN-9"], note: null, isLot: false, parts: [] },
      ],
      warrantyNotes: null,
      banks: [],
      company: {
        registeredName: "HACIEN Information Technology Solutions",
        tradeName: "",
        tin: "",
        address: "",
        phone: "",
        email: "",
        website: "",
        logoUrl: null,
      },
      qrSvg: "",
      policiesUrl: "https://haciensolutions.com/policies",
      versionLine: "Policies v2.2",
      missing: [],
      ...overrides,
    };
  }

  it("renders the contact person and phone in the customer box", () => {
    const html = renderToStaticMarkup(createElement(PackingListDocument, { sheet: sheetFixture() }));
    expect(html).toContain("Attn: ");
    expect(html).toContain("Maria Santos");
    expect(html).toContain("0917 123 4567");
  });

  it("renders no Attn line when the order has no contact", () => {
    const html = renderToStaticMarkup(
      createElement(PackingListDocument, { sheet: sheetFixture({ contactName: null, contactPhone: null }) }),
    );
    expect(html).not.toContain("Attn: ");
  });

  it("renders lot parts as sub-lines with their quantities, and whole quantities without decimals", () => {
    const html = renderToStaticMarkup(createElement(PackingListDocument, { sheet: sheetFixture() }));
    expect(html).toContain("Laptop unit");
    expect(html).toContain("2 pc");
    expect(html).toContain("Docking station");
    expect(html).toContain("1.50 pc");
    expect(html).toContain("3 pc");
    expect(html).not.toContain("2.00 pc");
    expect(html).not.toContain("3.00 pc");
  });
});
