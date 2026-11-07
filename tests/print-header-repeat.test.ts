import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The letterhead must print on EVERY page (owner 2026-11-07: "every page
// should have a header, thats why its called header"). Mechanism: every
// print shell wraps its document in PrintHeaderRepeat — a one-column table
// whose thead holds the letterhead; browsers repeat the thead at the top
// of every printed page, in normal flow (no overlap). position:fixed was
// rejected: Chrome anchors fixed print elements to the page content box
// and drops negatively-offset ones to the page bottom (verified in
// headless Chrome renders, 2026-11-07).
describe("letterhead repeats on every printed page", () => {
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

  it("every print shell routes its letterhead through PrintHeaderRepeat", () => {
    const shells = [
      "src/components/docs/ProfessionalPrintDocument.tsx",
      "src/components/docs/PackingListDocument.tsx",
      "src/app/print/books/[register]/page.tsx",
      "src/app/print/books/tax/2307-received/page.tsx",
      "src/app/print/books/tax/ewt-withheld/page.tsx",
      "src/app/print/books/tax/income/page.tsx",
      "src/app/print/books/tax/sales-summary/page.tsx",
    ];
    for (const file of shells) {
      const src = readFileSync(path.resolve(file), "utf8");
      // The letterhead is passed as the wrapper's header prop (the
      // professional shell wraps it in its .pp-head rule element first).
      const open = src.indexOf("<PrintHeaderRepeat");
      expect(open, file).toBeGreaterThan(-1);
      const lh = src.indexOf("<CompanyLetterhead", open);
      expect(lh, file).toBeGreaterThan(open);
      expect(src.slice(open, lh), file).toContain("header={");
    }
  });

  it("keeps the @page setup unchanged (the thead, not margins, carries the repeat)", () => {
    const margins = css.match(/margin: 0\.25in 0\.39in 0\.63in/g) ?? [];
    expect(margins.length).toBe(2); // @page (A4) and @page letter
  });
});
