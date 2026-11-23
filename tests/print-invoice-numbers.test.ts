import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfessionalPrintDocument } from "@/components/docs/ProfessionalPrintDocument";
import { PackingListDocument } from "@/components/docs/PackingListDocument";
import type { AttachmentSheet } from "@/lib/print/attachment";
import { billingPrintFixture } from "./fixtures/print-doc";

// Standardized invoice-number presentation (Jerwin 2026-11-21, "make
// them standardize"; VR1 D34 / Client F1): on every customer paper the
// Sales Invoice (booklet) number is the primary, clearly-labelled
// number ("Sales Invoice No. N") and the internal billing number
// (BL-YYYY-NNNN) appears smaller/secondary with its own label. Before
// this, the billing print headlined the BL number and buried the
// booklet number in a small "Booklet invoice no." cell, while the
// packing list called the same number "SI No." — a customer matching
// papers could not tell which number was the official invoice.

function docnumBlock(markup: string): string {
  const start = markup.indexOf('<div class="pp-docnum">');
  expect(start).toBeGreaterThan(-1);
  return markup.slice(start, start + 200);
}

describe("standardized invoice numbers — billing print", () => {
  const html = renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc: billingPrintFixture() }));

  it("headlines the Sales Invoice number under its own label", () => {
    const block = docnumBlock(html);
    expect(block).toContain('<div class="pp-docnum-label">Sales Invoice no.</div>');
    expect(block).toContain('<div class="pp-docnum-value">001</div>');
    expect(block).not.toContain("BL-2026-0001");
  });

  it("carries the internal billing number as a labelled secondary meta cell", () => {
    expect(html).toContain('<div class="pp-meta-label">Billing no.</div>');
    expect(html).toContain('<div class="pp-meta-value">BL-2026-0001</div>');
  });

  it("drops the old competing labels", () => {
    expect(html).not.toContain("Booklet invoice no.");
    expect(html).not.toContain("Sales Invoice no. (booklet)");
    expect(html).not.toContain('<div class="pp-docnum-label">Billing no.</div>');
  });
});

describe("standardized invoice numbers — packing list", () => {
  it("labels the linked invoice numbers 'Sales Invoice No.' under the DR number", () => {
    const sheet: AttachmentSheet = {
      deliveryId: "del-1",
      salesOrderId: "so-1",
      salesOrderNumber: "SO-2026-0001",
      drNumber: "10452",
      siNumbers: "010, 011",
      deliveryDate: "November 21, 2026",
      receivedBy: null,
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
      missing: [],
    };
    const html = renderToStaticMarkup(createElement(PackingListDocument, { sheet }));
    expect(html).toContain('<div class="pp-docnum-sub">Sales Invoice No. 010, 011</div>');
    expect(html).not.toContain("SI No.");
  });
});
