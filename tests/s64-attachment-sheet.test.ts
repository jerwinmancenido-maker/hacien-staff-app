import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatSiNumbers, itemMetaText, splitSerials, type AttachmentSheet } from "@/lib/print/attachment";
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
    // The disclaimer lines render the sheet's wording fields, sourced
    // from Settings wording (Company Profile slice 2) seeded verbatim
    // from the PACKING_LIST_DISCLAIMER / INPUT_TAX_DISCLAIMER constants
    // (BIR-WORDING.md rule 2); the exact texts are pinned in
    // tests/settings.test.ts and tests/print-documents.test.ts.
    expect(doc).toContain("sheet.packingDisclaimer");
    expect(doc).toContain("sheet.inputTaxDisclaimer");
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
    // D18 extended the select with the component's catalog identity
    // (brand/model/SKU) — still no supplier or cost fields.
    expect(model).toContain("item: { select: { brand: true, model: true, sku: true } }");
    expect(model).toContain("description: true,");
    expect(model).toContain("qty: true,");
    expect(model).toContain("unit: true,");
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
          meta: null,
          qty: "1 lot",
          serials: [],
          note: null,
          isLot: true,
          parts: [
            { description: "Laptop unit", qty: "2 pc", meta: "SKU LT-100 · Lenovo · ThinkPad T14" },
            { description: "Docking station", qty: "1.50 pc", meta: null },
          ],
        },
        {
          description: "HDMI cable",
          meta: "SKU CB-9 · Ugreen · 4K 2m",
          qty: "3 pc",
          serials: ["SN-9"],
          note: null,
          isLot: false,
          parts: [],
        },
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
      packingDisclaimer: "PACKING LIST / ATTACHMENT ONLY — NOT A BIR-REGISTERED SALES INVOICE, DELIVERY RECEIPT, OR COLLECTION/OFFICIAL RECEIPT. Not valid for claiming input tax; must accompany the official HACIEN Non-VAT Sales Invoice or BIR-registered Delivery Receipt.",
      inputTaxDisclaimer: "THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.",
      bankLabel: "HACIEN bank details",
      footerLine: "HACIEN Information Technology Solutions · sales@haciensolutions.com · haciensolutions.com",
      footerMark: "■ HACIEN",
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

// VR1 D18: brand/model/SKU reached no print. The packing list now prints
// the catalog identity as a muted sub-line where a line links to a
// catalog Item (top-level lines via their quote line; lot components
// directly). Free-text lines print exactly as before.
describe("S-64 attachment sheet — catalog identity (D18)", () => {
  const model = src("src/lib/print/attachment.ts");

  it("formats the meta in the editor caption's format, SKU first", () => {
    expect(itemMetaText({ sku: "LT-100", brand: "Lenovo", model: "ThinkPad T14" })).toBe(
      "SKU LT-100 · Lenovo · ThinkPad T14",
    );
    expect(itemMetaText({ sku: null, brand: "Ugreen", model: null })).toBe("Ugreen");
    expect(itemMetaText({ sku: "CB-9", brand: null, model: null })).toBe("SKU CB-9");
    expect(itemMetaText({ sku: null, brand: null, model: null })).toBeNull();
    expect(itemMetaText(null)).toBeNull();
    expect(itemMetaText(undefined)).toBeNull();
  });

  it("threads the item through the quote line for top-level lines, and directly for components", () => {
    expect(model).toContain("quoteItemId: true");
    expect(model).toContain("db.quoteItem.findMany");
    expect(model).toContain("itemByQuoteItemId");
    expect(model).toContain("meta: itemMetaText(c.item)");
  });

  it("renders the meta sub-line for linked lines and parts, and nothing for free-text lines", () => {
    const sheet: AttachmentSheet = {
      deliveryId: "del-1",
      salesOrderId: "so-1",
      salesOrderNumber: "SO-2026-0001",
      drNumber: "10452",
      siNumbers: "10",
      deliveryDate: "November 21, 2026",
      receivedBy: null,
      customerName: "Acme Corporation",
      customerAddress: "123 Gate Street, Pasig",
      contactName: null,
      contactPhone: null,
      items: [
        {
          description: "ICT Bundle",
          meta: null,
          qty: "1 lot",
          serials: [],
          note: null,
          isLot: true,
          parts: [{ description: "Laptop unit", qty: "2 pc", meta: "SKU LT-100 · Lenovo · ThinkPad T14" }],
        },
        {
          description: "HDMI cable",
          meta: "SKU CB-9 · Ugreen · 4K 2m",
          qty: "3 pc",
          serials: [],
          note: null,
          isLot: false,
          parts: [],
        },
        { description: "Free-text labour", meta: null, qty: "1 lot", serials: [], note: null, isLot: false, parts: [] },
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
      packingDisclaimer: "PACKING LIST / ATTACHMENT ONLY — NOT A BIR-REGISTERED SALES INVOICE, DELIVERY RECEIPT, OR COLLECTION/OFFICIAL RECEIPT. Not valid for claiming input tax; must accompany the official HACIEN Non-VAT Sales Invoice or BIR-registered Delivery Receipt.",
      inputTaxDisclaimer: "THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.",
      bankLabel: "HACIEN bank details",
      footerLine: "HACIEN Information Technology Solutions · sales@haciensolutions.com · haciensolutions.com",
      footerMark: "■ HACIEN",
      missing: [],
    };
    const html = renderToStaticMarkup(createElement(PackingListDocument, { sheet }));
    // Top-level linked line and linked lot part both show their identity.
    expect(html).toContain("SKU CB-9 · Ugreen · 4K 2m");
    expect(html).toContain("SKU LT-100 · Lenovo · ThinkPad T14");
    // Exactly two meta lines print — the free-text line adds none.
    expect(html.split("SKU ").length - 1).toBe(2);
    expect(html).toContain("Free-text labour");
  });
});

// Owner-approved print mock v2 enrichment (Jerwin 2026-11-21; VR1
// Driver F3): the Received by block was one unlabelled line — no
// printed name, designation or time, and no condition-of-goods
// wording — too weak as proof of delivery.
describe("S-64 attachment sheet — Received by block (mock v2 fields)", () => {
  function receivedSheet(receivedBy: string | null): AttachmentSheet {
    return {
      deliveryId: "del-1",
      salesOrderId: "so-1",
      salesOrderNumber: "SO-2026-0001",
      drNumber: "10452",
      siNumbers: "10",
      deliveryDate: "November 21, 2026",
      receivedBy,
      customerName: "Acme Corporation",
      customerAddress: "123 Gate Street, Pasig",
      contactName: null,
      contactPhone: null,
      items: [],
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
      packingDisclaimer: "PACKING LIST / ATTACHMENT ONLY — NOT A BIR-REGISTERED SALES INVOICE, DELIVERY RECEIPT, OR COLLECTION/OFFICIAL RECEIPT. Not valid for claiming input tax; must accompany the official HACIEN Non-VAT Sales Invoice or BIR-registered Delivery Receipt.",
      inputTaxDisclaimer: "THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.",
      bankLabel: "HACIEN bank details",
      footerLine: "HACIEN Information Technology Solutions · sales@haciensolutions.com · haciensolutions.com",
      footerMark: "■ HACIEN",
      missing: [],
    };
  }

  it("prints the labelled Printed name / Designation / Date & time fields and the condition line", () => {
    const html = renderToStaticMarkup(createElement(PackingListDocument, { sheet: receivedSheet(null) }));
    expect(html).toContain("Printed name: ");
    expect(html).toContain("Designation: ");
    expect(html).toContain("Date &amp; time: ");
    expect(html).toContain("Received in good condition unless noted here:");
    expect(html).toContain("pp-condition-line");
    // The signature line itself stays.
    expect(html).toContain("pp-sign-line");
  });

  it("fills the recorded name and delivery date into the fields when the receipt is recorded", () => {
    const html = renderToStaticMarkup(createElement(PackingListDocument, { sheet: receivedSheet("Juan Dela Cruz") }));
    const nameAt = html.indexOf("Printed name: ");
    expect(html.slice(nameAt, nameAt + 60)).toContain("Juan Dela Cruz");
    const timeAt = html.indexOf("Date &amp; time: ");
    expect(html.slice(timeAt, timeAt + 60)).toContain("November 21, 2026");
  });

  it("leaves the fields blank for handwriting when no receipt is recorded yet", () => {
    const html = renderToStaticMarkup(createElement(PackingListDocument, { sheet: receivedSheet(null) }));
    const timeAt = html.indexOf("Date &amp; time: ");
    // Nothing fills the Date & time field (the meta strip's own
    // "Delivery date" cell is a different, earlier part of the sheet).
    expect(html.slice(timeAt, timeAt + 40)).not.toContain("November 21, 2026");
    expect(html).not.toContain("Juan Dela Cruz");
  });
});
