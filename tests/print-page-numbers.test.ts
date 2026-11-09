import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Page X of Y CSS", () => {
  const css = readFileSync(path.resolve("src/app/globals.css"), "utf8");

  it("uses @page margins; page nums in @bottom-right, contact line in @bottom-left (no browser chrome boxes)", () => {
    expect(css).toContain("@page {");
    expect(css).toContain("size: A4");
    expect(css).toContain("margin: 0.25in 0.39in 0.63in");
    // Custom page label only — not Chrome's date/URL @top/@bottom chrome (dialog / --no-pdf-header-footer).
    expect(css).toContain("@bottom-right");
    expect(css).toContain("@bottom-left");
    expect(css).not.toContain("@bottom-center");
    // The generic @page stays free of @top boxes…
    const genericPage = css.slice(css.indexOf("@page {"), css.indexOf("@page letter"));
    expect(genericPage).not.toContain("@top-");
    // …while the named pp-doc page (v10 print redesign) carries the
    // identity strip in its top margin boxes, suppressed on page 1
    // together with the footer contact line, so nothing prints twice.
    expect(css).toContain(".pp-doc-root");
    expect(css).toMatch(/\.pp-doc-root\s*\{\s*page:\s*pp-doc/);
    expect(css).toMatch(/@page pp-doc\s*\{[\s\S]*?@top-left\s*\{\s*content: "■ HACIEN"/);
    expect(css).toMatch(/@page pp-doc:first\s*\{[\s\S]*?@top-left\s*\{\s*content: none/);
    expect(css).toMatch(/@page pp-doc:first\s*\{[\s\S]*?@bottom-left\s*\{\s*content: none/);
    // The v8 in-flow thead strip is gone (it duplicated page 1's title block).
    expect(css).not.toContain(".pp-runhead");
  });

  it("puts Page x of y in @page margin boxes; never paints in-flow Page 0 of 0", () => {
    // Margin boxes resolve counter(pages) in browser print and headless PDF.
    expect(css).toMatch(/@page\s*\{[\s\S]*?@bottom-right\s*\{[\s\S]*?content:\s*"Page " counter\(page\) " of " counter\(pages\)/);
    // Letterhead Template v3 footer: contact line lower-left.
    expect(css).toMatch(/@bottom-left\s*\{[\s\S]*?content:\s*"HACIEN Information Technology Solutions/);
    // In-flow ::after with counter(pages) becomes "Page 0 of 0" in headless --print-to-pdf.
    expect(css).toMatch(/\.pp-page-num::after\s*\{[^}]*content:\s*none/s);
    expect(css).not.toMatch(
      /\.pp-page-num::after\s*\{[^}]*content:\s*"Page " counter\(page\) " of " counter\(pages\)/s,
    );
  });

  it("hides screen-only chrome and [not set] placeholders in @media print", () => {
    expect(css).toMatch(/@media print[\s\S]*\.no-print/);
    expect(css).toMatch(/@media print[\s\S]*\.pp-missing/);
    expect(css).toMatch(/@media print[\s\S]*\.print-toolbar/);
    expect(css).toMatch(/display:\s*none\s*!important/);
  });

  it("uses HACIEN brand kit: Inter + Archivo Black, ink text, navy structure (v8), #2563EB accents", () => {
    expect(css).toContain('font-family: "Inter"');
    expect(css).toContain('font-family: "Archivo Black"');
    expect(css).toContain("--font-display:");
    expect(css).toContain('url("/fonts/Inter-Regular.woff2")');
    expect(css).toContain('url("/fonts/ArchivoBlack-Regular.woff2")');
    expect(css).toContain("--blue: #2563eb");
    expect(css).toContain("--ink: #0a0a0a");
    expect(css).toContain("--grey-200: #e5e5e5");
    expect(css).toContain(".pp-title-pixel");
    expect(css).toContain("width: 45mm"); // logo-full letterhead (≥40mm)
    expect(css).toContain(".pp-logo-clearspace");
    expect(css).toContain("padding: 2.2mm"); // clear space ≈ 2× blue square at 45mm
    expect(css).toContain("font-size: 17pt"); // document title (Archivo Black)
    // Unboxed Bill/Deliver; totals table itself stays transparent — the
    // emphasized TOTAL row is the dark navy band (v8 redesign).
    expect(css).toMatch(/\.pp-party-box\s*\{[^}]*border:\s*none/s);
    expect(css).toMatch(/\.pp-totals\s*\{[^}]*background:\s*transparent/s);
    expect(css).toContain("border-top: 1px solid #e5e5e5");
    expect(css).toContain("--pp-navy: #0d1526");
    expect(css).toMatch(/\.pp-total-emph th,\s*\.pp-total-emph td\s*\{[^}]*background:\s*var\(--pp-navy\)/s);
    // Dark navy items header band (v8); upright text; 60mm signature line
    expect(css).toMatch(/\.pp-items thead th\s*\{[^}]*background:\s*var\(--pp-navy\)/s);
    expect(css).not.toMatch(/\.pp-words\s*\{[^}]*font-style:\s*italic/s);
    expect(css).not.toMatch(/\.pp-thank-you\s*\{[^}]*font-style:\s*italic/s);
    expect(css).toMatch(/\.pp-sign-line\s*\{[^}]*width:\s*60mm/s);
    expect(css).toMatch(/\.pp-foot\s*\{[^}]*margin-top:\s*14px/s);
  });
});



