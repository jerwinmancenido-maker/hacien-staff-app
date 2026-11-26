// Company Profile slice 2: print identity + wording derivations.
// The @page footer identity, the tax footer lines and the quote/SO terms
// block now read from Settings (identity + wording sections, pinned per
// document). These tests pin the derivations and the seed equalities that
// keep the rendered output byte-identical while the seeded values stand.

import { describe, expect, it } from "vitest";
import { printCompanyBlock, printFooterIdentity } from "@/lib/print/company";
import { printFooterCss, printGenericFooterCss } from "@/lib/print/strip-style";
import { taxFooterLines, type PrintDocKind } from "@/lib/print/tax-wording";
import {
  buildQuoteSoTermsPoints,
  quoteSoTermsPoint2,
  quoteSoTermsPoint3,
  quoteValiditySentence,
} from "@/lib/print/terms-block";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import type { Settings } from "@/lib/settings/schema";

const company: Settings["company"] = {
  name: "Dummy Trading Corp",
  tradeName: "Dummy",
  tin: "000-000-000-00000",
  address: "1 Nowhere St",
  phone: "",
  email: "hello@dummy.example",
  website: "dummy.example",
  logoStorageKey: "",
};

describe("printFooterIdentity (census F1)", () => {
  it("derives the footer line and mark from a dummy company", () => {
    const identity = { ...DEFAULT_SETTINGS.identity, appShortName: "DUMMY" };
    const { line, mark } = printFooterIdentity(company, identity);
    expect(line).toBe("Dummy Trading Corp · hello@dummy.example · dummy.example");
    expect(mark).toBe("■ DUMMY");
  });

  it("skips blank parts and falls back to the trade name", () => {
    const { line } = printFooterIdentity(
      { ...company, name: "  ", email: "", website: "" },
      DEFAULT_SETTINGS.identity,
    );
    expect(line).toBe("Dummy");
  });

  it("seeded values reproduce the identity globals.css used to hard-code", () => {
    const seeded = {
      ...DEFAULT_SETTINGS.company,
      name: "HACIEN INFORMATION TECHNOLOGY SOLUTIONS",
      email: "sales@haciensolutions.com",
      website: "haciensolutions.com",
    };
    const { line, mark } = printFooterIdentity(seeded, DEFAULT_SETTINGS.identity);
    expect(line).toBe(
      "HACIEN INFORMATION TECHNOLOGY SOLUTIONS · sales@haciensolutions.com · haciensolutions.com",
    );
    expect(mark).toBe("■ HACIEN");
  });
});

describe("footer @page CSS emission", () => {
  it("pp-doc rules carry the line, the mark and the :first suppressions", () => {
    const css = printFooterCss("A · a@b.co · b.co", "■ A");
    expect(css).toContain('@page pp-doc { @top-left { content: "■ A"; }');
    expect(css).toContain('@bottom-left { content: "A · a@b.co · b.co"; } }');
    expect(css).toContain("@page pp-doc:first { @top-left { content: none; } @bottom-left { content: none; } }");
    expect(css).toContain("@page pp-doc-letter { @top-left { content:");
    expect(css).toContain("@page pp-doc-letter:first { @top-left { content: none; }");
  });

  it("generic rules carry only the bottom-left line, for both page variants", () => {
    const css = printGenericFooterCss("A · a@b.co · b.co");
    expect(css).toContain('@page { @bottom-left { content: "A · a@b.co · b.co"; } }');
    expect(css).toContain('@page letter { @bottom-left { content: "A · a@b.co · b.co"; } }');
    expect(css).not.toContain("@top-left");
  });

  it("escapes quotes and backslashes in the identity", () => {
    const css = printGenericFooterCss('A "Quoted" \\ Co');
    expect(css).toContain('content: "A \\"Quoted\\" \\\\ Co"');
  });
});

describe("taxFooterLines with settings wording (census F3)", () => {
  const wording = {
    billingDisclaimer: "CUSTOM BILLING DISCLAIMER",
    inputTaxDisclaimer: "CUSTOM INPUT TAX LINE",
    quotationNotInvoice: "CUSTOM QUOTE NOTE",
    salesOrderNotInvoice: "CUSTOM SO NOTE",
  };

  it("billing prints the wording disclaimer + input-tax line", () => {
    expect(taxFooterLines("billing", { wording })).toEqual([
      "CUSTOM BILLING DISCLAIMER",
      "CUSTOM INPUT TAX LINE",
    ]);
  });

  it("statements print the wording billing disclaimer", () => {
    expect(taxFooterLines("customer_statement", { wording })).toEqual(["CUSTOM BILLING DISCLAIMER"]);
  });

  it("quote and sales order print their wording notes", () => {
    expect(taxFooterLines("quote", { wording })).toEqual(["CUSTOM QUOTE NOTE"]);
    expect(taxFooterLines("sales_order", { wording })).toEqual(["CUSTOM SO NOTE"]);
  });

  it("seeded wording renders exactly what the constants rendered", () => {
    const kinds: PrintDocKind[] = [
      "quote",
      "sales_order",
      "billing",
      "collection",
      "customer_statement",
      "supplier_po",
      "receiving_report",
      "supplier_payment",
      "expense",
      "supplier_statement",
    ];
    for (const kind of kinds) {
      expect(taxFooterLines(kind, { wording: DEFAULT_SETTINGS.wording })).toEqual(taxFooterLines(kind));
    }
  });
});

describe("terms block with settings wording (census F4)", () => {
  it("point 2 COD is the wording text, verbatim", () => {
    const wording = { ...DEFAULT_SETTINGS.wording, termsPoint2Cod: "COD CUSTOM TEXT" };
    expect(quoteSoTermsPoint2("COD", wording)).toBe("COD CUSTOM TEXT");
  });

  it("point 7 follows the wording, figures included", () => {
    const wording = {
      ...DEFAULT_SETTINGS.wording,
      termsPoint7: "Late: 30% interest a year, plus 10% attorney's fees.",
      termsLateInterestPctPerYear: 30,
      termsAttorneysFeesPct: 10,
    };
    const points = buildQuoteSoTermsPoints({}, wording);
    expect(points[points.length - 1]).toBe("7. Late: 30% interest a year, plus 10% attorney's fees.");
  });

  it("point 3 substitutes {days} in the wording template", () => {
    expect(quoteSoTermsPoint3(9)).toContain("lead time: 9 business days");
    const wording = { ...DEFAULT_SETTINGS.wording, termsPoint3WithLeadTime: "Lead: {days} days." };
    expect(quoteSoTermsPoint3(9, wording)).toBe("Lead: 9 days.");
  });

  it("seeded wording renders the identical block to the fallback", () => {
    const input = { validityDays: 30, paymentTerms: "COD", leadTimeDays: 5 };
    expect(buildQuoteSoTermsPoints(input, DEFAULT_SETTINGS.wording)).toEqual(
      buildQuoteSoTermsPoints(input),
    );
  });
});

describe("validity comparator seed equality", () => {
  it("the settings seed's standard validity is 15, today's constant", () => {
    expect(DEFAULT_SETTINGS.quotes.defaultValidityDays).toBe(15);
  });

  it("a span of 15 (or null) prints the default sentence; 30 prints the custom sentence", () => {
    expect(quoteValiditySentence(15)).toBe(DEFAULT_SETTINGS.wording.termsPoint1ValidityDefault);
    expect(quoteValiditySentence(null)).toBe(DEFAULT_SETTINGS.wording.termsPoint1ValidityDefault);
    expect(quoteValiditySentence(30)).toBe("This quotation is valid for 30 days.");
  });
});

describe("printCompanyBlock wording", () => {
  it("carries the NON-VAT label from wording when a snapshot is passed", () => {
    expect(printCompanyBlock(company, DEFAULT_SETTINGS.wording).nonVatLabel).toBe("NON-VAT");
    expect(printCompanyBlock(company).nonVatLabel).toBeUndefined();
  });
});
