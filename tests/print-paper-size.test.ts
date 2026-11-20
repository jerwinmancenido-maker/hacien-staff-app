// F25 (final-check S112): the print paper-size setting must reach
// the printed page. A named @page rule does nothing until an element
// selects it with the CSS `page` property — nothing did, so every
// print came out A4 whatever the setting said. These guards pin the
// bindings; the page-size proof itself is a print-to-PDF measurement
// (Letter = 612×792pt, A4 = 595×842pt) recorded on the PR.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { printStripCss } from "@/lib/print/strip-style";

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const css = read("src/app/globals.css");

describe("F25 paper-size bindings", () => {
  it("generic Letter shells select the letter page", () => {
    expect(css).toContain(".print-shell-letter {\n  page: letter;\n}");
    expect(css).toContain("@page letter {\n  size: letter;");
  });

  it("pp-doc has a Letter twin with the same margins and boxes", () => {
    expect(css).toContain("@page pp-doc-letter {\n  size: letter;");
    expect(css).toContain("@page pp-doc-letter:first {");
    expect(css).toContain(".pp-page.pp-paper-letter {\n  page: pp-doc-letter;\n}");
  });

  it("the identity strip is emitted for both named pages", () => {
    const strip = printStripCss("QUOTATION · QT-2026-0019");
    expect(strip).toContain("@page pp-doc-letter { @top-right { content: \"QUOTATION · QT-2026-0019\";");
    expect(strip).toContain("@page pp-doc-letter:first { @top-right { content: none; } }");
  });

  it("the books/tax print pages carry the settings paper-size class", () => {
    for (const page of [
      "src/app/print/books/[register]/page.tsx",
      "src/app/print/books/tax/2307-received/page.tsx",
      "src/app/print/books/tax/ewt-withheld/page.tsx",
      "src/app/print/books/tax/income/page.tsx",
      "src/app/print/books/tax/sales-summary/page.tsx",
    ]) {
      expect(read(page)).toContain("print-shell print-shell-${settings.print.paperSize.toLowerCase()}");
    }
  });

  it("no books/tax toolbar still hard-codes A4", () => {
    expect(read("src/app/print/books/[register]/page.tsx")).not.toContain(">A4 ·");
    expect(read("src/app/print/books/tax/income/page.tsx")).not.toContain(">A4 ·");
  });
});
