import { describe, expect, it } from "vitest";
import { cssContentString, printStripCss } from "@/lib/print/strip-style";

describe("print strip CSS (v10 margin-box identity strip)", () => {
  it("bakes the strip text into @top-right and suppresses it on page 1", () => {
    const css = printStripCss("QUOTATION · QT-2026-0019");
    expect(css).toContain('@page pp-doc { @top-right { content: "QUOTATION · QT-2026-0019";');
    expect(css).toContain("@page pp-doc:first { @top-right { content: none; } }");
    // The :first rule must come after the strip rule in the same block —
    // a later plain @page rule would otherwise re-introduce it on page 1.
    expect(css.indexOf("@page pp-doc:first")).toBeGreaterThan(css.indexOf("@top-right { content: \"QUOTATION"));
  });

  it("escapes quotes, backslashes and newlines in the content string", () => {
    expect(cssContentString('PO "rev" \\ 2\nline')).toBe('"PO \\"rev\\" \\\\ 2 line"');
  });
});
