// Render/snapshot coverage for every printable document, watermarks, tax wording,
// and customer/supplier information boundaries.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfessionalPrintDocument } from "@/components/docs/ProfessionalPrintDocument";
import { PrintShell } from "@/components/docs/PrintShell";
import {
  FORBIDDEN_VAT_PHRASES,
  INPUT_TAX_DISCLAIMER,
  NON_VAT_LABEL,
  NOT_OFFICIAL_INVOICE,
  QUOTATION_NOT_INVOICE,
  SALES_ORDER_NOT_INVOICE,
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
  withholdingQuotePrintFixture,
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
    expect(taxFooterLines("quote")).toEqual([QUOTATION_NOT_INVOICE]);
    expect(taxFooterLines("sales_order")).toEqual([SALES_ORDER_NOT_INVOICE]);
    expect(taxFooterLines("collection", { showInputTaxDisclaimer: true })).toEqual([
      NOT_OFFICIAL_INVOICE,
      INPUT_TAX_DISCLAIMER,
    ]);
  });

  it("each document type gets its own footer (snapshot of tax lines)", () => {
    const byKind: Record<string, string[]> = {
      quote: taxFooterLines("quote"),
      sales_order: taxFooterLines("sales_order"),
      billing: taxFooterLines("billing", { showInputTaxDisclaimer: true }),
      collection: taxFooterLines("collection", { showInputTaxDisclaimer: true }),
      customer_statement: taxFooterLines("customer_statement"),
      supplier_statement: taxFooterLines("supplier_statement"),
      supplier_po: taxFooterLines("supplier_po"),
      receiving_report: taxFooterLines("receiving_report"),
      supplier_payment: taxFooterLines("supplier_payment"),
      expense: taxFooterLines("expense"),
    };
    expect(byKind.quote).toEqual([QUOTATION_NOT_INVOICE]);
    expect(byKind.sales_order).toEqual([SALES_ORDER_NOT_INVOICE]);
    expect(byKind.billing).toEqual([NOT_OFFICIAL_INVOICE, INPUT_TAX_DISCLAIMER]);
    expect(html(quotePrintFixture())).toContain(QUOTATION_NOT_INVOICE);
    expect(html(salesOrderPrintFixture())).toContain(SALES_ORDER_NOT_INVOICE);
    expect(html(salesOrderPrintFixture())).not.toContain(QUOTATION_NOT_INVOICE);
    expect(byKind).toMatchSnapshot();
  });

  it("never puts [not set] placeholders in print HTML; empty address/TIN omit the line", () => {
    const empty = html({
      ...quotePrintFixture(),
      company: { ...quotePrintFixture().company, tin: "", address: "" },
    });
    expect(empty.toLowerCase()).not.toContain("[not set");
    expect(empty).not.toContain("pp-missing");
    expect(empty).toContain(NON_VAT_LABEL);
    expect(empty).not.toMatch(/>TIN\s*</);
    const filled = html(quotePrintFixture());
    expect(filled).toContain("TIN 123-456-789-000");
    expect(filled).toContain("Unit 1, Sample St.");
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

  it("hides internal status on printed quote, SO and billing (screen-only row)", () => {
    for (const fixture of [quotePrintFixture, salesOrderPrintFixture, billingPrintFixture]) {
      const markup = html(fixture());
      expect(markup).toContain('class="pp-status-row no-print"');
      expect(markup).toContain(`>${fixture().status}<`);
    }
    // Supplier PO still prints status.
    const po = html(poPrintFixture());
    expect(po).toContain('class="pp-status-row"');
    expect(po).not.toContain("pp-status-row no-print");
  });

  it("shows company email in the letterhead whenever it is set", () => {
    const withEmail = html(quotePrintFixture());
    expect(withEmail).toContain("billing@example.com");
    const noEmail = html({
      ...quotePrintFixture(),
      company: { ...quotePrintFixture().company, email: "" },
    });
    expect(noEmail).not.toContain("billing@example.com");
    expect(noEmail).toContain("+63 2 8123 4567");
  });

  it("uses brand kit logo-full.svg by default and allows a settings logo override", () => {
    const brand = html({ ...quotePrintFixture(), company: { ...quotePrintFixture().company, logoUrl: null } });
    expect(brand).toContain('src="/brand/logo-full.svg"');
    expect(brand).toContain('class="pp-title-pixel"');
    const custom = html({
      ...quotePrintFixture(),
      company: { ...quotePrintFixture().company, logoUrl: "/files/company-logo" },
    });
    expect(custom).toContain('src="/files/company-logo"');
    expect(custom).not.toContain("/brand/logo-full.svg");
  });

  it("shows Bill to / Deliver to boxes with Attn on customer docs", () => {
    const markup = html(quotePrintFixture());
    expect(markup).toContain("Bill to");
    expect(markup).toContain("Deliver to");
    expect(markup).toContain("Attn:");
    expect(markup).toContain("Ana Cruz");
  });

  it("shows Valid until on quotes; print never shows withholding / WHT / ATC / %", () => {
    expect(html(quotePrintFixture())).toContain("Valid until");
    const markup = html(withholdingQuotePrintFixture());
    const lower = markup.toLowerCase();
    const totalsBlob = (markup.match(/pp-totals[\s\S]*?<\/table>/i)?.[0] ?? "").toLowerCase();
    expect(totalsBlob).toContain("subtotal");
    expect(totalsBlob).toContain("total");
    expect(totalsBlob).not.toContain("less");
    expect(totalsBlob).not.toContain("net");
    expect(totalsBlob).not.toContain("withholding");
    expect(totalsBlob).not.toContain("wht");
    expect(totalsBlob).not.toContain("atc");
    expect(totalsBlob).not.toMatch(/%/);
    expect(lower).not.toContain("less: withholding");
    expect(lower).not.toContain("net amount due");
    expect(lower).not.toContain("withholding tax");
    expect(lower).not.toContain("internal — withholding");
    expect(lower).not.toContain("unit cost");
    expect(lower).not.toContain("margin");
  });

  it("never prints QA admin on signature lines", () => {
    const markup = html({
      ...quotePrintFixture(),
      signatories: [
        { role: "Prepared by", name: "QA admin", position: null },
        { role: "Conforme", name: null },
      ],
    });
    expect(markup.toLowerCase()).not.toContain("qa admin");
  });
});

describe("print shell screen-only chrome", () => {
  it("marks Back / Print buttons and missing-field warnings as no-print", () => {
    const markup = renderToStaticMarkup(
      createElement(PrintShell, {
        backHref: "/quotes/1",
        doc: quotePrintFixture(),
        missing: ["TIN", "address"],
        canManageSettings: true,
      }),
    );
    expect(markup).toContain("no-print");
    expect(markup).toContain("Print / Save PDF");
    expect(markup).toContain("Back");
    expect(markup).toMatch(/tax-cal-notice[^>]*no-print|no-print[^>]*tax-cal-notice/);
    expect(markup).toContain("Add your TIN and address so they print on documents.");
  });
});

