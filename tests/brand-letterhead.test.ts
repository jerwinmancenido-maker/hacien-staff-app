import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfessionalPrintDocument } from "@/components/docs/ProfessionalPrintDocument";
import { BRAND_LETTERHEAD_LOGO, mergeCompanyLetterhead, printCompanyBlock } from "@/lib/print/company";
import { quotePrintFixture } from "./fixtures/print-doc";

const base = {
  name: "HACIEN Sample Trading Co.",
  tradeName: "HACIEN",
  tin: "000-000-000-00000",
  address: "Sample St.",
  phone: "",
  email: "billing@example.com",
  website: "",
  logoStorageKey: "",
};

describe("mergeCompanyLetterhead", () => {
  it("uses current Settings when there is no pin", () => {
    expect(mergeCompanyLetterhead(null, base)).toEqual(base);
  });

  it("falls back field-by-field when the pin is blank", () => {
    const merged = mergeCompanyLetterhead(
      { ...base, tin: "", address: "  ", phone: "+63 2 1111" },
      { ...base, tin: "123-456-789-000", address: "QC", phone: "+63 2 9999" },
    );
    expect(merged.tin).toBe("123-456-789-000");
    expect(merged.address).toBe("QC");
    expect(merged.phone).toBe("+63 2 1111");
  });

  it("keeps non-blank pinned values over a different current TIN/address", () => {
    const merged = mergeCompanyLetterhead(
      { ...base, tin: "111-222-333-000", address: "Makati" },
      { ...base, tin: "999-888-777-000", address: "Pasig", name: "Renamed Co." },
    );
    expect(merged.tin).toBe("111-222-333-000");
    expect(merged.address).toBe("Makati");
    expect(merged.name).toBe("HACIEN Sample Trading Co.");
  });
});

describe("brand letterhead logo", () => {
  it("defaults to public/brand/logo-full.svg when no settings logo is uploaded", () => {
    expect(BRAND_LETTERHEAD_LOGO).toBe("/brand/logo-full.svg");
    const block = printCompanyBlock({
      name: "HACIEN Sample Trading Co.",
      tradeName: "HACIEN",
      tin: "000-000-000-00000",
      address: "Sample St.",
      phone: "",
      email: "billing@example.com",
      website: "",
      logoStorageKey: "",
    });
    expect(block.logoUrl).toBe("/brand/logo-full.svg");
  });

  it("lets a Settings upload override the brand kit logo", () => {
    const block = printCompanyBlock({
      name: "HACIEN Sample Trading Co.",
      tradeName: "HACIEN",
      tin: "000-000-000-00000",
      address: "Sample St.",
      phone: "",
      email: "",
      website: "",
      logoStorageKey: "company-logo-abc",
    });
    expect(block.logoUrl).toBe("/files/company-logo");
  });
});

describe("letterhead Template v3 layout", () => {
  it("title block sits below the header rule, not inside the header", () => {
    const markup = renderToStaticMarkup(
      createElement(ProfessionalPrintDocument, { doc: quotePrintFixture() }),
    );
    const headerClose = markup.indexOf("</header>");
    const titleBlock = markup.indexOf("pp-title-block");
    expect(headerClose).toBeGreaterThan(-1);
    expect(titleBlock).toBeGreaterThan(headerClose);
    expect(markup.slice(0, headerClose)).not.toContain("pp-title-block");
    expect(markup.slice(headerClose)).toContain("QUOTATION");
  });

  it("company details are right-aligned and the footer uses left contact / right page number", () => {
    const css = readFileSync(path.resolve("src/app/globals.css"), "utf8");
    expect(css).toContain(".pp-letterhead-text {\n  min-width: 0;\n  text-align: right;");
    expect(css).toContain("justify-content: flex-end;");
    expect((css.match(/@bottom-left \{/g) || []).length).toBe(2);
    expect((css.match(/@bottom-right \{/g) || []).length).toBe(2);
    expect((css.match(/@bottom-center \{/g) || []).length).toBe(0);
    expect(css).toContain(
      '@bottom-left {\n    content: "HACIEN Information Technology Solutions · sales@haciensolutions.com · haciensolutions.com";',
    );
  });

  it("letterhead address wraps in balanced lines, not one long line plus a short tail", () => {
    const css = readFileSync(path.resolve("src/app/globals.css"), "utf8");
    const start = css.indexOf(".pp-letterhead-text .pp-pre {");
    expect(start).toBeGreaterThan(-1);
    expect(css.slice(start, start + 300)).toContain("text-wrap: balance;");
  });

  it("no company name line above the address (owner 2026-11-07 — the logo carries the name)", () => {
    const markup = renderToStaticMarkup(
      createElement(ProfessionalPrintDocument, { doc: quotePrintFixture() }),
    );
    expect(markup).not.toContain("pp-company-line");
    expect(markup).not.toContain("HACIEN Sample Trading Co.");
    // The header still renders the letterhead text block (address/TIN/contact).
    expect(markup).toContain("pp-letterhead-text");
  });
});
