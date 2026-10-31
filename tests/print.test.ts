// Legacy print smoke tests — superseded in depth by print-documents.test.ts.
// Keeps the QR + NON-VAT + no-cost assertions that older suites expected.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfessionalPrintDocument } from "@/components/docs/ProfessionalPrintDocument";
import { qrSvg, TERMS_URL } from "@/lib/print/qr";
import { NON_VAT_LABEL } from "@/lib/print/tax-wording";
import { quotePrintFixture } from "./fixtures/print-doc";

describe("print document", () => {
  it("renders NON-VAT, the QR code, the footer and the contract price", async () => {
    const doc = { ...quotePrintFixture(), qrSvg: await qrSvg(), termsUrl: TERMS_URL };
    const html = renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc }));
    expect(html).toContain(NON_VAT_LABEL);
    expect(html).toContain("<svg");
    expect(html).toContain("QT-2026-0001");
    expect(html).toContain("₱520,000.00");
    expect(html).toContain("Terms and conditions:");
  });

  it("has no costs, margins, or supplier info on customer quote", async () => {
    const html = renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc: quotePrintFixture() })).toLowerCase();
    for (const word of ["supplier", "margin", "unit cost", "withholding", "net received"]) {
      expect(html, word).not.toContain(word);
    }
  });

  it("generates the QR locally for the terms URL", async () => {
    const svg = await qrSvg();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(TERMS_URL).toBe("https://haciensolutions.com/terms");
  });
});
