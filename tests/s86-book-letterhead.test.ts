import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { printCompanyBlock } from "@/lib/print/company";

// S-86, option A: the 5 book/tax prints use the same shared letterhead as
// the 10 professional documents. No Template v3 redesign, no tax-wording
// change: the shared component still renders the NON-VAT tag.

const BOOK_PAGES = [
  "src/app/print/books/[register]/page.tsx",
  "src/app/print/books/tax/2307-received/page.tsx",
  "src/app/print/books/tax/ewt-withheld/page.tsx",
  "src/app/print/books/tax/income/page.tsx",
  "src/app/print/books/tax/sales-summary/page.tsx",
];

describe("S-86 shared letterhead on book/tax prints", () => {
  it("all 5 book/tax pages render the shared CompanyLetterhead from current Settings", () => {
    for (const rel of BOOK_PAGES) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src).toContain('import { CompanyLetterhead } from "@/components/docs/CompanyLetterhead"');
      expect(src).toContain("<CompanyLetterhead company={printCompanyBlock(company)} />");
      // Old per-page brand block is gone (the shared component renders it now).
      expect(src).not.toContain('className="print-brand"');
      expect(src).not.toContain("NON-VAT · TIN {company.tin");
    }
  });

  it("ProfessionalPrintDocument still uses the same shared component (10 documents unchanged)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/docs/ProfessionalPrintDocument.tsx"),
      "utf8",
    );
    expect(src).toContain('import { CompanyLetterhead } from "@/components/docs/CompanyLetterhead"');
    expect(src).toContain("<CompanyLetterhead company={doc.company} />");
    // The local copy was moved, not duplicated.
    expect(src).not.toContain("function CompanyLetterhead");
  });

  it("the shared component source renders the NON-VAT tag and logo fallback", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/docs/CompanyLetterhead.tsx"),
      "utf8",
    );
    expect(src).toContain("{NON_VAT_LABEL}");
    expect(src).toContain("BRAND_LETTERHEAD_LOGO");
    expect(src).toContain("pp-letterhead");
  });

  it("printCompanyBlock maps book-page Settings to the letterhead block, with empty fields blank", () => {
    const block = printCompanyBlock({
      name: "HACIEN Sample Trading Co.",
      tradeName: "HACIEN",
      tin: "",
      address: "",
      phone: "+63 2 1111",
      email: "billing@example.com",
      website: "haciensolutions.com",
      logoStorageKey: "",
    });
    expect(block.registeredName).toBe("HACIEN Sample Trading Co.");
    expect(block.tin).toBe("");
    expect(block.address).toBe("");
    expect(block.phone).toBe("+63 2 1111");
    expect(block.email).toBe("billing@example.com");
    expect(block.logoUrl).toBe("/brand/logo-full.svg");
  });

  it("printCompanyBlock uses the uploaded logo when a Settings logo exists", () => {
    const block = printCompanyBlock({
      name: "HACIEN Sample Trading Co.",
      tradeName: "",
      tin: "000-000-000-00000",
      address: "Sample St.",
      phone: "",
      email: "",
      website: "",
      logoStorageKey: "company-logo-1",
    });
    expect(block.logoUrl).toBe("/files/company-logo");
  });
});
