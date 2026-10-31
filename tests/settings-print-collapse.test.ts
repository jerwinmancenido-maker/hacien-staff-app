// Print & company: collapsible sections stay mounted so collapsed fields still submit.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams("tab=print"),
}));

import { PrintCompanyForm } from "@/app/(app)/settings/PrintCompanyForm";
import type { FormState } from "@/lib/validation/forms";
import type { Settings } from "@/lib/settings/schema";

const noopAction = async (): Promise<FormState> => ({ ok: true });

const company: Settings["company"] = {
  name: "HACIEN Sample Co",
  tradeName: "HACIEN",
  tin: "000-000-000-000",
  address: "1 Sample St",
  phone: "02-0000",
  email: "office@example.com",
  website: "https://example.com",
  logoStorageKey: "",
};

const print: Settings["print"] = {
  paperSize: "A4",
  showInputTaxDisclaimer: true,
  showReceivingReportCosts: false,
  quoteTerms: "Net 30",
  deliveryNotes: "Deliver weekdays",
  warrantyNotes: "1 year",
  banks: [
    {
      bankName: "Sample Bank",
      accountName: "HACIEN",
      accountLast4: "1234",
      printFullAccountNumber: true,
      accountNumberFull: "1234-5678-9012",
    },
  ],
  eWallets: [],
};

describe("PrintCompanyForm collapsed sections", () => {
  it("keeps every section mounted with aria-expanded and collapsed fields still in the form", () => {
    const html = renderToStaticMarkup(
      createElement(PrintCompanyForm, {
        company,
        print,
        versionId: "ver-print",
        action: noopAction,
      }),
    );

    expect(html).toContain('data-section="letterhead"');
    expect(html).toContain('data-section="paper"');
    expect(html).toContain('data-section="notes"');
    expect(html).toContain('data-section="payment"');

    // First open, others collapsed — but panels remain in markup (hidden-not-unmounted).
    expect(html).toMatch(/data-section="letterhead"[^>]*>[\s\S]*?aria-expanded="true"/);
    expect(html).toMatch(/data-section="paper"[^>]*>[\s\S]*?aria-expanded="false"/);
    expect(html).toMatch(/data-section="notes"[^>]*>[\s\S]*?aria-expanded="false"/);
    expect(html).toMatch(/data-section="payment"[^>]*>[\s\S]*?aria-expanded="false"/);

    expect(html).toContain('data-collapsed="0"'); // letterhead open
    expect(html).toContain('data-collapsed="1"'); // at least one collapsed
    expect(html).toContain("is-collapsed");

    // Fields from collapsed sections still present for submit.
    expect(html).toContain('name="paperSize"');
    expect(html).toContain('name="showInputTaxDisclaimer"');
    expect(html).toContain('name="quoteTerms"');
    expect(html).toContain('name="deliveryNotes"');
    expect(html).toContain('name="warrantyNotes"');
    expect(html).toContain('name="banks.0.bankName"');
    expect(html).toContain('name="banks.0.accountNumberFull"');
    expect(html).toContain('value="1234-5678-9012"');

    // Pairing: trade name + TIN present; email + website present.
    expect(html).toContain('name="tradeName"');
    expect(html).toContain('name="tin"');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="website"');

    expect(html).toContain("print-company-preview");
    expect(html).toContain("Live preview");
  });

  it("collapsed sections still contribute field values (not disabled / not omitted)", () => {
    const html = renderToStaticMarkup(
      createElement(PrintCompanyForm, {
        company,
        print,
        versionId: "ver-print",
        action: noopAction,
      }),
    );

    // Behavior check without a DOM: collapsed-section controls keep name + current
    // value and are not disabled, so a real form submit would include them.
    const inputs = [
      { name: "banks.0.bankName", valueAttr: 'value="Sample Bank"' },
      { name: "banks.0.accountNumberFull", valueAttr: 'value="1234-5678-9012"' },
    ] as const;
    for (const field of inputs) {
      const re = new RegExp(`<[^>]+name="${field.name.replace(/\./g, "\\.")}"[^>]*>`);
      const tag = html.match(re)?.[0];
      expect(tag, `control ${field.name}`).toBeTruthy();
      expect(tag!).not.toMatch(/\bdisabled\b/);
      expect(tag!).toContain(field.valueAttr);
    }

    // Textareas put their value between tags (not value="…").
    expect(html).toMatch(/<textarea[^>]*name="quoteTerms"[^>]*>Net 30<\/textarea>/);
    expect(html).toMatch(/<textarea[^>]*name="deliveryNotes"[^>]*>Deliver weekdays<\/textarea>/);
    expect(html).toMatch(/<textarea[^>]*name="warrantyNotes"[^>]*>1 year<\/textarea>/);
    expect(html).not.toMatch(/name="quoteTerms"[^>]*\bdisabled\b/);

    // Select keeps selected option; checkbox stays checked via hidden+checkbox pair.
    expect(html).toMatch(/<select[^>]*name="paperSize"[^>]*>[\s\S]*?<option value="A4" selected=""/);
    expect(html).toMatch(/name="showInputTaxDisclaimer"[^>]*value="true"|value="true"[^>]*name="showInputTaxDisclaimer"/);
    expect(html).toMatch(/id="showInputTaxDisclaimer"[^>]*checked|checked[^>]*id="showInputTaxDisclaimer"/);
  });
});
