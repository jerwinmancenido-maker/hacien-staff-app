// Legacy print smoke tests — superseded in depth by print-documents.test.ts.
// Keeps the QR + NON-VAT + no-cost assertions that older suites expected.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfessionalPrintDocument } from "@/components/docs/ProfessionalPrintDocument";
import { qrSvg, TERMS_URL } from "@/lib/print/qr";
import { NON_VAT_LABEL } from "@/lib/print/tax-wording";
import { quotePrintFixture, salesOrderPrintFixture, withholdingQuotePrintFixture } from "./fixtures/print-doc";

describe("print document", () => {
  it("renders NON-VAT, the QR code, the footer and the contract price", async () => {
    const doc = { ...quotePrintFixture(), qrSvg: await qrSvg(), termsUrl: TERMS_URL };
    const html = renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc }));
    expect(html).toContain(NON_VAT_LABEL);
    expect(html).toContain("<svg");
    expect(html).toContain("QT-2026-0001");
    expect(html).toContain("₱520,000.00");
    expect(html).toContain("Terms:");
  });

  it("has no costs, margins, or supplier info on customer quote", async () => {
    const html = renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc: quotePrintFixture() })).toLowerCase();
    for (const word of ["supplier", "margin", "unit cost", "net received"]) {
      expect(html, word).not.toContain(word);
    }
  });

  it("never prints withholding on customer quotes (internal estimate only)", () => {
    const plain = renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc: quotePrintFixture() })).toLowerCase();
    const wht = renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc: withholdingQuotePrintFixture() })).toLowerCase();
    for (const html of [plain, wht]) {
      expect(html).not.toContain("withholding tax (est.)");
      expect(html).not.toContain("net amount due");
      expect(html).not.toContain("wht");
      expect(html).not.toContain("atc");
      expect(html).toContain("subtotal");
      expect(html).toContain("total");
    }
  });

  it("generates the QR locally for the terms URL", async () => {
    const svg = await qrSvg();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(TERMS_URL).toBe("https://haciensolutions.com/policies");
  });

  it("quote and sales order print HTML use the policies URL", async () => {
    const svg = await qrSvg();
    for (const fixture of [quotePrintFixture, salesOrderPrintFixture]) {
      const doc = { ...fixture(), qrSvg: svg, termsUrl: TERMS_URL };
      const html = renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc }));
      expect(html).toContain("<svg");
      expect(html).toContain("https://haciensolutions.com/policies");
      expect(html).not.toContain("haciensolutions.com/terms");
    }
  });
});
