// The A4 print page: NON-VAT label, QR code to the terms page, footer text,
// no signature lines, and nothing about costs, margins or withholding.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrintDocument } from "@/components/docs/PrintDocument";
import { qrSvg, TERMS_URL } from "@/lib/print/qr";
import type { PrintDoc } from "@/lib/quotes/views";

const doc: PrintDoc = {
  title: "Quotation",
  number: "QT-2026-0001",
  status: "SENT",
  date: "2026-10-30",
  validUntil: "2026-11-29",
  buyerPoNo: null,
  buyerPoDate: null,
  deliveryAddress: null,
  company: { name: "HACIEN", tin: "123-456-789-000", address: "Quezon City" },
  customer: { name: "TESDA Regional Office", address: "Quezon City", tin: "000-111-222-000" },
  contact: { name: "Ana Cruz", email: "ana@example.com", phone: null },
  items: [{ description: "Laptop i5", qty: "10.00", unit: "pc", unitPrice: "52000.00", total: "520000.00" }],
  contractPrice: "520000.00",
  terms: "Net 30",
  notes: null,
};

describe("print document", () => {
  it("renders NON-VAT, the QR code, the footer and the contract price", async () => {
    const html = renderToStaticMarkup(createElement(PrintDocument, { doc, qrSvg: await qrSvg() }));
    expect(html).toContain("NON-VAT");
    expect(html).toContain("<svg");
    expect(html).toContain(`QR code to ${TERMS_URL}`);
    expect(html).toContain("This is a system-generated document. No signature required.");
    expect(html).toContain("QT-2026-0001");
    expect(html).toContain("₱520,000.00");
    expect(html).toContain("Net 30");
  });

  it("has no costs, margins, withholding or signature lines", async () => {
    const html = renderToStaticMarkup(createElement(PrintDocument, { doc, qrSvg: await qrSvg() })).toLowerCase();
    for (const word of ["supplier", "margin", "cost", "withholding", "net received", "signature over", "signed by", "approved by", "conforme"]) {
      expect(html, word).not.toContain(word);
    }
  });

  it("generates the QR locally for the terms URL", async () => {
    const svg = await qrSvg();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(TERMS_URL).toBe("https://haciensolutions.com/terms");
  });
});
