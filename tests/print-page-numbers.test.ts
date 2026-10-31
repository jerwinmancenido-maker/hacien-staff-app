import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Page X of Y CSS", () => {
  const css = readFileSync(path.resolve("src/app/globals.css"), "utf8");

  it("uses @page margins without browser header/footer margin boxes", () => {
    expect(css).toContain("@page {");
    expect(css).toContain("size: A4");
    expect(css).toContain("margin: 18mm");
    // Page numbers live in the document footer, not @bottom-* boxes (those fight Chrome chrome).
    expect(css).not.toContain("@bottom-right");
    expect(css).not.toContain("@bottom-center");
    expect(css).not.toContain("@top-left");
    expect(css).not.toContain("@top-center");
  });

  it("puts Page x of y in the in-document footer via .pp-page-num", () => {
    expect(css).toContain(".pp-page-num::after");
    expect(css).toContain('content: "Page " counter(page) " of " counter(pages)');
  });

  it("hides screen-only chrome and [not set] placeholders in @media print", () => {
    expect(css).toMatch(/@media print[\s\S]*\.no-print/);
    expect(css).toMatch(/@media print[\s\S]*\.pp-missing/);
    expect(css).toMatch(/@media print[\s\S]*\.print-toolbar/);
    expect(css).toMatch(/display:\s*none\s*!important/);
  });

  it("uses HACIEN brand kit: Inter + Archivo Black, ink text, #E5E5E5 rules, #2563EB title pixel only", () => {
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
    expect(css).toContain("font-size: 18pt"); // document title (Archivo Black)
    // Unboxed Bill/Deliver + totals: thin #E5E5E5 rules, no shaded totals fill
    expect(css).toMatch(/\.pp-party-box\s*\{[^}]*border:\s*none/s);
    expect(css).toMatch(/\.pp-totals\s*\{[^}]*background:\s*transparent/s);
    expect(css).toContain("border-top: 1px solid #e5e5e5");
  });
});



