// Render/snapshot coverage for every printable document, watermarks, tax wording,
// and customer/supplier information boundaries.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfessionalPrintDocument } from "@/components/docs/ProfessionalPrintDocument";
import {
  FORBIDDEN_VAT_PHRASES,
  INPUT_TAX_DISCLAIMER,
  NON_VAT_LABEL,
  NOT_OFFICIAL_INVOICE,
  STATEMENT_NOT_OFFICIAL,
  taxFooterLines,
} from "@/lib/print/tax-wording";
import {
  billingPrintFixture,
  collectionPrintFixture,
  customerStatementFixture,
  draftPoFixture,
  expensePrintFixture,
  poPrintFixture,
  quotePrintFixture,
  rrPrintFixture,
  salesOrderPrintFixture,
  supplierPaymentPrintFixture,
  supplierStatementFixture,
  voidQuoteFixture,
} from "./fixtures/print-doc";

function html(doc: Parameters<typeof ProfessionalPrintDocument>[0]["doc"]) {
  return renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc }));
}

const docs = [
  ["quote", quotePrintFixture],
  ["sales_order", salesOrderPrintFixture],
  ["billing", billingPrintFixture],
  ["collection", collectionPrintFixture],
  ["supplier_po", poPrintFixture],
  ["receiving_report", rrPrintFixture],
  ["supplier_payment", supplierPaymentPrintFixture],
  ["expense", expensePrintFixture],
  ["customer_statement", customerStatementFixture],
  ["supplier_statement", supplierStatementFixture],
] as const;

describe("professional print documents", () => {
  for (const [kind, fixture] of docs) {
    it(`renders ${kind} with letterhead, peso amounts, and NON-VAT`, () => {
      const markup = html(fixture());
      expect(markup).toContain(NON_VAT_LABEL);
      expect(markup).toContain("TIN 123-456-789-000");
      // Default RR print is qty-only (no peso columns) unless the costs setting is ON.
      if (kind !== "receiving_report") expect(markup).toContain("₱");
      expect(markup).toMatchSnapshot();
    });
  }

  it("shows VOID and DRAFT watermarks", () => {
    expect(html(voidQuoteFixture())).toContain("VOID");
    expect(html(draftPoFixture())).toContain("DRAFT");
  });

  it("customer prints never show supplier costs or margins", () => {
    for (const fixture of [quotePrintFixture, salesOrderPrintFixture, billingPrintFixture, collectionPrintFixture, customerStatementFixture]) {
      const lower = html(fixture()).toLowerCase();
      for (const word of ["unit cost", "supplier cost", "margin", "net margin"]) {
        expect(lower, word).not.toContain(word);
      }
      // Customer docs must not name the sample supplier.
      expect(lower).not.toContain("uno computer");
    }
  });

  it("supplier prints never show customer selling price or margin", () => {
    for (const fixture of [poPrintFixture, rrPrintFixture, supplierPaymentPrintFixture, supplierStatementFixture]) {
      const lower = html(fixture()).toLowerCase();
      expect(lower).not.toContain("unit price");
      expect(lower).not.toContain("margin");
      expect(lower).not.toContain("tesda");
      expect(lower).not.toContain("52000");
    }
  });

  it("never prints VAT wording", () => {
    for (const [, fixture] of docs) {
      const lower = html(fixture()).toLowerCase();
      expect(lower).toContain("non-vat");
      for (const phrase of FORBIDDEN_VAT_PHRASES) {
        expect(lower, phrase).not.toContain(phrase);
      }
      // Guard against a bare "VAT" token that isn't NON-VAT.
      expect(lower.replaceAll("non-vat", "")).not.toMatch(/\bvat\b/);
    }
  });

  it("billing and collection say not an official invoice and include the input-tax note", () => {
    for (const fixture of [billingPrintFixture, collectionPrintFixture]) {
      const markup = html(fixture());
      expect(markup).toContain(NOT_OFFICIAL_INVOICE);
      expect(markup).toContain(INPUT_TAX_DISCLAIMER);
    }
  });

  it("customer statement does not include the input-tax disclaimer", () => {
    const markup = html(customerStatementFixture());
    expect(markup).not.toContain(INPUT_TAX_DISCLAIMER);
    expect(taxFooterLines("customer_statement", { showInputTaxDisclaimer: true })).toEqual([STATEMENT_NOT_OFFICIAL]);
    expect(taxFooterLines("customer_statement", { showInputTaxDisclaimer: false })).toEqual([STATEMENT_NOT_OFFICIAL]);
  });

  it("keeps tax footer lines in the shared config module", () => {
    expect(taxFooterLines("billing", { showInputTaxDisclaimer: true })).toEqual([
      NOT_OFFICIAL_INVOICE,
      INPUT_TAX_DISCLAIMER,
    ]);
    expect(taxFooterLines("billing", { showInputTaxDisclaimer: false })).toEqual([NOT_OFFICIAL_INVOICE]);
    expect(taxFooterLines("quote")).toEqual([]);
    expect(taxFooterLines("collection", { showInputTaxDisclaimer: true })).toEqual([
      NOT_OFFICIAL_INVOICE,
      INPUT_TAX_DISCLAIMER,
    ]);
  });

  it("masks payment accounts to last 4 digits only", () => {
    const markup = html(quotePrintFixture());
    expect(markup).toContain("****1234");
    expect(markup).not.toMatch(/account\s+\d{5,}/i);
  });

  it("prints amount in words and thank-you on customer docs", () => {
    const markup = html(quotePrintFixture());
    expect(markup).toContain("Five hundred twenty thousand pesos only");
    expect(markup).toContain("Thank you for your business");
  });

  it("includes EWT/2307 note on supplier payment voucher fixture", () => {
    expect(html(supplierPaymentPrintFixture())).toContain("BIR Form 2307");
  });
});
