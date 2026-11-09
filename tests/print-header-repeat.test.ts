import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The letterhead must print on EVERY page (owner 2026-11-07: "every page
// should have a header, thats why its called header"). Mechanism for the
// book/tax shells: PrintHeaderRepeat — a one-column table whose thead
// holds the letterhead; browsers repeat the thead at the top of every
// printed page, in normal flow (no overlap). position:fixed was
// rejected: Chrome anchors fixed print elements to the page content box
// and drops negatively-offset ones to the page bottom (verified in
// headless Chrome renders, 2026-11-07).
//
// The professional documents and the packing list left this mechanism in
// the v8/v10 redesigns (owner 2026-11-09): the letterhead prints once, in
// flow on page 1, and page 2+ carry the identity strip from the @page
// margin boxes instead — a thead repeats identically on page 1 too,
// which duplicated the title block there.
//
// Owner reversal for the professional documents (2026-11-10, on
// QT-2026-0005): page 2 without a header "is not professional looking" —
// the letterhead now rides the thead for ProfessionalPrintDocument too
// (the letterhead exists ONLY in the thead, so page 1 shows it once, in
// flow — no duplication). The margin-box strip stays: it carries the
// document title + number, which the letterhead does not. The packing
// list keeps the v10 strip-only design (warehouse document, out of the
// scope of the owner's complaint).
describe("page headers: thead letterhead (books + professional docs) vs margin-box strip (packing list)", () => {
  const css = readFileSync(path.resolve("src/app/globals.css"), "utf8");
  const shell = readFileSync(
    path.resolve("src/components/docs/PrintHeaderRepeat.tsx"),
    "utf8",
  );

  it("PrintHeaderRepeat renders the header inside a table thead", () => {
    expect(shell).toContain('<table className="pp-repeat"');
    expect(shell).toContain("<thead>");
    expect(shell).toContain('className="pp-repeat-head"');
    expect(shell).toContain('className="pp-repeat-body"');
  });

  it("the wrapper table is a transparent container (screen preview unchanged)", () => {
    expect(css).toMatch(/\.pp-repeat\s*\{\s*width:\s*100%;\s*border-collapse:\s*collapse;/);
    expect(css).toMatch(/\.pp-repeat-head\s*\{[^}]*padding:\s*0;/s);
    expect(css).toMatch(/\.pp-repeat-body\s*\{[^}]*padding:\s*0;/s);
  });

  it("book/tax shells route their letterhead through PrintHeaderRepeat", () => {
    const shells = [
      "src/app/print/books/[register]/page.tsx",
      "src/app/print/books/tax/2307-received/page.tsx",
      "src/app/print/books/tax/ewt-withheld/page.tsx",
      "src/app/print/books/tax/income/page.tsx",
      "src/app/print/books/tax/sales-summary/page.tsx",
    ];
    for (const file of shells) {
      const src = readFileSync(path.resolve(file), "utf8");
      const open = src.indexOf("<PrintHeaderRepeat");
      expect(open, file).toBeGreaterThan(-1);
      const lh = src.indexOf("<CompanyLetterhead", open);
      expect(lh, file).toBeGreaterThan(open);
      expect(src.slice(open, lh), file).toContain("header={");
    }
  });

  it("professional documents route their letterhead through PrintHeaderRepeat (owner 2026-11-10)", () => {
    const src = readFileSync(
      path.resolve("src/components/docs/ProfessionalPrintDocument.tsx"),
      "utf8",
    );
    const open = src.indexOf("<PrintHeaderRepeat");
    expect(open).toBeGreaterThan(-1);
    const lh = src.indexOf("<CompanyLetterhead", open);
    expect(lh).toBeGreaterThan(open);
    expect(src.slice(open, lh)).toContain("header={");
    expect(src).toContain("pp-doc-root");
    // The strip stays — it carries title + number, not letterhead data.
    expect(src).toContain("printStripCss");
  });

  it("packing-list shell keeps the margin-box strip (v10), not the thead", () => {
    const src = readFileSync(
      path.resolve("src/components/docs/PackingListDocument.tsx"),
      "utf8",
    );
    expect(src).not.toContain("PrintHeaderRepeat");
    expect(src).toContain("pp-doc-root");
    expect(src).toContain("printStripCss");
    expect(src).toContain("<CompanyLetterhead");
  });

  it("keeps the @page setup unchanged (the thead, not margins, carries the repeat)", () => {
    const margins = css.match(/margin: 0\.25in 0\.39in 0\.63in/g) ?? [];
    expect(margins.length).toBe(2); // @page (A4) and @page letter
  });
});

describe("print pagination: closing sections flow, small units stay whole (owner 2026-11-10)", () => {
  const css = readFileSync(path.resolve("src/app/globals.css"), "utf8");

  it(".pp-closing is NOT one unbreakable block in print (the page-1 gap)", () => {
    expect(css).not.toContain("  .pp-closing {\n    break-inside: avoid;\n  }");
  });

  it("the totals table and the amount-in-words line stay whole", () => {
    expect(css).toContain(
      "  .pp-totals {\n    break-inside: avoid;\n    break-before: avoid;\n  }",
    );
    expect(css).toContain("  .pp-words {\n    break-inside: avoid;\n  }");
  });
});

describe("print design variables reach every pp-doc root", () => {
  const css = readFileSync(path.resolve("src/app/globals.css"), "utf8");

  it("defines the --pp-* palette on .pp-doc-root, not only on .pp-page", () => {
    // The packing list root is .print-page.pp-doc-root (no .pp-page): when
    // the palette lived only on .pp-page, every var()-based colour on the
    // packing sheet silently dropped out — the dark items-table header
    // band most visibly (white header text on a transparent band). Found
    // on the DR012 staging proof, 2026-11-09.
    expect(css).toMatch(/\.pp-doc-root\s*\{[^}]*--pp-navy:\s*#0d1526;/s);
    expect(css).toMatch(/\.pp-doc-root\s*\{[^}]*--pp-accent:/s);
    expect(css).toMatch(/\.pp-page\s*\{[^}]*--pp-navy:\s*#0d1526;/s);
  });
});
