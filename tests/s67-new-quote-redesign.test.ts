import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// S-67: new quote page redesign — no withholding warning before a
// customer is picked; withholding as one summary line in Quote details
// (the picker itself moved to its own tab in the 2026-11-07 UI plan —
// no more Change link / expand-in-place); tidy 2-column grid with even
// field widths; full width; Items visible without scrolling (Items is
// the default tab).

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("S-67 new quote page redesign", () => {
  it("withholding warning banner only shows once a customer is picked", () => {
    const src = read("src/components/docs/QuoteEditor.tsx");
    expect(src).toContain("const notSet = pick == null && customer != null;");
  });

  it("withholding is one summary line in details; the picker lives on its own tab", () => {
    const src = read("src/components/docs/QuoteEditor.tsx");
    expect(src).toContain('className="wh-collapsed-row"');
    // No expand-in-place Change link anymore.
    expect(src).not.toContain("WITHHOLDING_PICK_CHANGE_LABEL");
    expect(src).not.toContain("whPickOpen");
    // A dedicated Withholding tab, second after Items, holds the picker.
    expect(src).toContain('"withholding"');
    expect(src).toContain('onClick={() => setTab("withholding")}');
    expect(src).toContain('{tab === "withholding" && (');
    expect(src).toContain("<WithholdingPickField");
  });

  it("details grid is 2 columns with even fields; editor uses full width", () => {
    const css = read("src/app/globals.css");
    expect(css).toMatch(/\.quote-fg \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/\.quote-editor \{[^}]*max-width: none;/);
    const src = read("src/components/docs/QuoteEditor.tsx");
    // Details-card Customer and Buyer PO are single-column now.
    expect(src).toContain('className={`quote-f field${e.customerId');
    expect(src).toContain('className={`quote-f field${e.buyerPoNo');
  });

  it("Items is the default tab, so items are visible without scrolling past tabs", () => {
    const src = read("src/components/docs/QuoteEditor.tsx");
    expect(src).toContain('useState<TabId>("items")');
  });
});
