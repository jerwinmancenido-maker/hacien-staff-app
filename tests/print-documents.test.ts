// Render/snapshot coverage for every printable document, watermarks, tax wording,
// and customer/supplier information boundaries.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfessionalPrintDocument } from "@/components/docs/ProfessionalPrintDocument";
import { PrintShell } from "@/components/docs/PrintShell";
import { POLICIES_URL, POLICY_VERSION_LINE } from "@/lib/print/policies";
import { qrSvg, TERMS_URL } from "@/lib/print/qr";
import {
  getQuoteSoTermsPoints,
  quoteSoTermsPoint1,
  quoteValiditySentence,
  TERMS_AND_CONDITIONS_HEADING,
} from "@/lib/print/terms-block";
import { validUntilFromDays } from "@/lib/quotes/validity";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import { customerMoneyTotals } from "@/lib/print/views";
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

  it("statements label the number block with the party, not a document number", () => {
    // Statements have no number — the "number" is the party name (owner 2026-11-07).
    // The label lives in the doc-number block since the v8 print redesign.
    const customer = html(customerStatementFixture());
    expect(customer).toContain('<div class="pp-docnum-label">Customer</div>');
    expect(customer).not.toContain('<div class="pp-docnum-label">No.</div>');
    const supplier = html(supplierStatementFixture());
    expect(supplier).toContain('<div class="pp-docnum-label">Supplier</div>');
    expect(supplier).not.toContain('<div class="pp-docnum-label">No.</div>');
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
      const withoutNonVat = lower.replaceAll("non-vat", "");
      for (const phrase of FORBIDDEN_VAT_PHRASES) {
        expect(withoutNonVat, phrase).not.toContain(phrase);
      }
      // Guard against a bare "VAT" token that isn't NON-VAT.
      expect(withoutNonVat).not.toMatch(/\bvat\b/);
    }
  });

  it("prints the input-tax line on billing and collection only (not quote / SO / statement)", () => {
    expect(INPUT_TAX_DISCLAIMER).toBe("THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.");
    const withLine = [
      ["billing", billingPrintFixture],
      ["collection", collectionPrintFixture],
    ] as const;
    const withoutLine = [
      ["quote", quotePrintFixture],
      ["sales_order", salesOrderPrintFixture],
      ["customer_statement", customerStatementFixture],
      ["supplier_po", poPrintFixture],
      ["supplier_statement", supplierStatementFixture],
    ] as const;
    for (const [kind, fixture] of withLine) {
      expect(taxFooterLines(kind, { showInputTaxDisclaimer: false }), kind).toContain(INPUT_TAX_DISCLAIMER);
      expect(taxFooterLines(kind, { showInputTaxDisclaimer: true }), kind).toContain(INPUT_TAX_DISCLAIMER);
      expect(html(fixture()), kind).toContain(INPUT_TAX_DISCLAIMER);
    }
    for (const [kind, fixture] of withoutLine) {
      expect(taxFooterLines(kind, { showInputTaxDisclaimer: true }), kind).not.toContain(INPUT_TAX_DISCLAIMER);
      expect(html(fixture()), kind).not.toContain(INPUT_TAX_DISCLAIMER);
    }
  });

  it("billing and collection say not an official invoice and include the input-tax note", () => {
    for (const fixture of [billingPrintFixture, collectionPrintFixture]) {
      const markup = html(fixture());
      expect(markup).toContain(NOT_OFFICIAL_INVOICE);
      expect(markup).toContain(INPUT_TAX_DISCLAIMER);
    }
  });

  it("customer statement includes the official-statement line and omits the input-tax line", () => {
    const markup = html(customerStatementFixture());
    expect(markup).toContain(STATEMENT_NOT_OFFICIAL);
    expect(markup).not.toContain(INPUT_TAX_DISCLAIMER);
    expect(taxFooterLines("customer_statement", { showInputTaxDisclaimer: true })).toEqual([STATEMENT_NOT_OFFICIAL]);
    expect(taxFooterLines("customer_statement", { showInputTaxDisclaimer: false })).toEqual([STATEMENT_NOT_OFFICIAL]);
  });

  it("keeps tax footer lines in the shared config module", () => {
    expect(taxFooterLines("billing", { showInputTaxDisclaimer: true })).toEqual([
      NOT_OFFICIAL_INVOICE,
      INPUT_TAX_DISCLAIMER,
    ]);
    expect(taxFooterLines("billing", { showInputTaxDisclaimer: false })).toEqual([
      NOT_OFFICIAL_INVOICE,
      INPUT_TAX_DISCLAIMER,
    ]);
    expect(taxFooterLines("quote")).toEqual([QUOTATION_NOT_INVOICE]);
    expect(taxFooterLines("sales_order")).toEqual([SALES_ORDER_NOT_INVOICE]);
    expect(taxFooterLines("collection", { showInputTaxDisclaimer: false })).toEqual([
      NOT_OFFICIAL_INVOICE,
      INPUT_TAX_DISCLAIMER,
    ]);
  });

  it("each document type gets its own footer (snapshot of tax lines)", () => {
    const byKind: Record<string, string[]> = {
      quote: taxFooterLines("quote"),
      sales_order: taxFooterLines("sales_order"),
      billing: taxFooterLines("billing", { showInputTaxDisclaimer: false }),
      collection: taxFooterLines("collection", { showInputTaxDisclaimer: false }),
      customer_statement: taxFooterLines("customer_statement", { showInputTaxDisclaimer: false }),
      supplier_statement: taxFooterLines("supplier_statement"),
      supplier_po: taxFooterLines("supplier_po"),
      receiving_report: taxFooterLines("receiving_report"),
      supplier_payment: taxFooterLines("supplier_payment"),
      expense: taxFooterLines("expense"),
    };
    expect(byKind.quote).toEqual([QUOTATION_NOT_INVOICE]);
    expect(byKind.sales_order).toEqual([SALES_ORDER_NOT_INVOICE]);
    expect(byKind.billing).toEqual([NOT_OFFICIAL_INVOICE, INPUT_TAX_DISCLAIMER]);
    expect(byKind.customer_statement).toEqual([STATEMENT_NOT_OFFICIAL]);
    expect(byKind.supplier_statement).toEqual([STATEMENT_NOT_OFFICIAL]);
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

  it("omits the Status row on every outside print", () => {
    for (const [, fixture] of docs) {
      const markup = html(fixture());
      expect(markup).not.toContain(">Status<");
      expect(markup).not.toContain("Status:");
      expect(markup).not.toContain("pp-status-row");
    }
    expect(html(quotePrintFixture())).not.toContain(">SENT<");
    expect(html(poPrintFixture())).not.toContain(">OPEN<");
    expect(html(draftPoFixture())).toContain("DRAFT");
    expect(html(voidQuoteFixture())).toContain("VOID");
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
    expect(totalsBlob).not.toContain("subtotal"); // owner 2026-11-09: Subtotal row removed — it duplicated the Total
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

  it("v10: identity strip is an emitted @page style, never in-flow markup", () => {
    const markup = html(quotePrintFixture());
    expect(markup).toContain("pp-doc-root");
    expect(markup).toContain(
      '@page pp-doc { @top-right { content: "QUOTATION · QT-2026-0001";',
    );
    expect(markup).toContain("@page pp-doc:first { @top-right { content: none; } }");
    // The v8 thead strip duplicated the title block on page 1 — it is gone.
    expect(markup).not.toContain("pp-runhead");
    expect(markup).not.toContain("pp-repeat");
  });

  it("v10: statement strip carries the title only, not the party name", () => {
    const fixture = customerStatementFixture();
    const markup = html(fixture);
    const style = markup.slice(markup.indexOf("<style>"), markup.indexOf("</style>"));
    expect(style).toContain("STATEMENT OF ACCOUNT");
    expect(style).not.toContain(fixture.party.name.toUpperCase());
  });

  it("v10: signatory Date label prints only with a date (or on hand-sign roles)", () => {
    const withDates = html({
      ...poPrintFixture(),
      signatories: [
        { role: "Prepared by", name: "HACIEN Sales", date: "Nov 9, 2026, 10:00 AM" },
        { role: "Approved by", name: "HACIEN Sales", date: "Nov 9, 2026, 11:00 AM" },
        { role: "Received by", name: null },
      ],
    });
    expect(withDates.match(/pp-sign-date">Date</g)).toHaveLength(3);
    const noDates = html({
      ...poPrintFixture(),
      signatories: [
        { role: "Prepared by", name: "HACIEN Sales" },
        { role: "Approved by", name: null },
        { role: "Received by", name: null },
      ],
    });
    // Only Received by keeps the write-in Date prompt.
    expect(noDates.match(/pp-sign-date">Date</g)).toHaveLength(1);
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
    expect(markup).not.toContain(`· ${quotePrintFixture().status} ·`);
    expect(markup).toMatch(/tax-cal-notice[^>]*no-print|no-print[^>]*tax-cal-notice/);
    expect(markup).toContain("Add your TIN and address so they print on documents.");
  });
});

describe("Q12 prints legal terms, validity, payment terms, tax line, QR and policies", () => {
  it("input-tax disclaimer is on billing and collection only; absent on quote, SO, statement", () => {
    for (const kind of ["billing", "collection"] as const) {
      expect(taxFooterLines(kind, { showInputTaxDisclaimer: false })).toContain(INPUT_TAX_DISCLAIMER);
      expect(taxFooterLines(kind, { showInputTaxDisclaimer: true })).toContain(INPUT_TAX_DISCLAIMER);
    }
    for (const kind of ["quote", "sales_order", "customer_statement"] as const) {
      expect(taxFooterLines(kind, { showInputTaxDisclaimer: true })).not.toContain(INPUT_TAX_DISCLAIMER);
      expect(taxFooterLines(kind, { showInputTaxDisclaimer: false })).not.toContain(INPUT_TAX_DISCLAIMER);
    }
  });

  it("never contains bare VAT on any print document", () => {
    for (const [, fixture] of docs) {
      const markup = html(fixture());
      expect(markup).toContain("NON-VAT");
      const withoutNonVat = markup.toLowerCase().replaceAll("non-vat", "");
      for (const phrase of FORBIDDEN_VAT_PHRASES) {
        expect(withoutNonVat).not.toContain(phrase);
      }
      expect(withoutNonVat).not.toMatch(/\bvat\b/);
    }
  });

  it("NON-VAT totals math remains Total only (no Subtotal row, no withholding lines)", () => {
    const totals = customerMoneyTotals({
      contractPrice: "520000.00",
      withholdingTotal: "5200.00",
      netReceived: "514800.00",
      withholding: [
        {
          code: "GOODS_1",
          label: "Withholding on goods",
          lineKind: "GOODS",
          rate: "0.0100",
          atcCode: "WC158",
        },
      ],
    });
    expect(totals).toEqual([{ label: "Total", amount: "520000.00", emphasize: true }]);
  });

  it("validity default 15 + override: sentence formatting and date calculation", () => {
    expect(quoteValiditySentence(15)).toBe("This quotation is valid for 15 days unless the quote states otherwise.");
    expect(quoteValiditySentence(null)).toBe("This quotation is valid for 15 days unless the quote states otherwise.");
    expect(quoteValiditySentence(undefined)).toBe("This quotation is valid for 15 days unless the quote states otherwise.");
    expect(quoteValiditySentence(7)).toBe("This quotation is valid for 7 days.");
    expect(quoteValiditySentence(30)).toBe("This quotation is valid for 30 days.");

    // Valid until = date + N
    expect(validUntilFromDays("2026-11-02", 15)).toBe("2026-11-17");
    expect(validUntilFromDays("2026-11-02", 7)).toBe("2026-11-09");
    expect(validUntilFromDays("2026-11-02", 30)).toBe("2026-12-02");

    // Point 1 integration
    expect(quoteSoTermsPoint1(15)).toContain("This quotation is valid for 15 days unless the quote states otherwise.");
    expect(quoteSoTermsPoint1(7)).toContain("This quotation is valid for 7 days.");
  });

  it("payment terms list contains exactly 3 options for new records", () => {
    const terms = DEFAULT_SETTINGS.lists.paymentTerms;
    expect(terms).toHaveLength(3);
    expect(terms).toEqual([
      "50% down, 50% on delivery",
      "100% upfront (software and special orders)",
      "Net 30 (approved accounts only)",
    ]);
    expect(terms).not.toContain("COD");
    expect(terms).not.toContain("Net 15");
    expect(terms).not.toContain("Net 60");
  });

  it("QR URL is exactly https://haciensolutions.com/policies and policies constants match specs", () => {
    expect(POLICIES_URL).toBe("https://haciensolutions.com/policies");
    expect(TERMS_URL).toBe("https://haciensolutions.com/policies");
    expect(POLICY_VERSION_LINE).toBe(
      "Terms of Sale v1.1 · Warranty v1.1 · Privacy v2.3 · haciensolutions.com/policies",
    );
  });

  it("version line from constant appears on quote and SO prints", () => {
    const quoteHtml = html(quotePrintFixture());
    expect(quoteHtml).toContain(POLICY_VERSION_LINE);

    const soHtml = html(salesOrderPrintFixture());
    expect(soHtml).toContain(POLICY_VERSION_LINE);
  });

  it("7-point terms block text on quote and SO prints includes 2307 requirement (point 6)", () => {
    const defaultPoints = getQuoteSoTermsPoints(15);
    expect(defaultPoints).toHaveLength(7);
    expect(defaultPoints[0]).toContain("1. This quotation is valid for 15 days unless the quote states otherwise.");
    expect(defaultPoints[1]).toContain("2. Payment: 50% down payment when you order, 50% on delivery.");
    expect(defaultPoints[2]).toContain("3. Lead times are estimates, not fixed deadlines, and are subject to supplier stock.");
    expect(defaultPoints[3]).toContain("4. On delivery, note any missing boxes");
    expect(defaultPoints[4]).toContain("5. Unless specific warranty notes on this quotation state otherwise, warranty is the manufacturer's or distributor's");
    expect(defaultPoints[5]).toContain("6. If you withhold tax, tell us before paying and give us a signed BIR Form 2307 upon payment.");
    expect(defaultPoints[6]).toContain("7. HACIEN keeps ownership of the goods until they are fully paid.");
    expect(defaultPoints[6]).toContain("Accounts unpaid past their due date are charged 24% interest a year");
    expect(defaultPoints[6]).toContain("Full Terms of Sale apply: haciensolutions.com/terms-of-sale");

    const quoteHtml = html(quotePrintFixture());
    expect(quoteHtml).toContain(TERMS_AND_CONDITIONS_HEADING);
    expect(quoteHtml).toContain("6. If you withhold tax, tell us before paying and give us a signed BIR Form 2307 upon payment.");

    // Custom validity override on quote
    const customQuoteHtml = html({
      ...quotePrintFixture(),
      termsBlock: getQuoteSoTermsPoints(7),
    });
    expect(customQuoteHtml).toContain("1. This quotation is valid for 7 days.");
  });

  // Lawyer/CPA sign-off 2026-11-06: point 7 of the quote/SO terms block ends
  // with the approved "Full Terms of Sale apply: haciensolutions.com/terms-of-sale"
  // line. No other print may link to the terms page.
  it("only quote and SO prints contain haciensolutions.com/terms-of-sale", async () => {
    const svg = await qrSvg();
    for (const [name, fixture] of docs) {
      const doc = { ...fixture(), qrSvg: svg, termsUrl: TERMS_URL };
      const markup = html(doc);
      if (name === "quote" || name === "sales_order") {
        expect(markup).toContain("Full Terms of Sale apply: haciensolutions.com/terms-of-sale");
      } else {
        expect(markup).not.toContain("haciensolutions.com/terms");
      }
    }
  });
});

