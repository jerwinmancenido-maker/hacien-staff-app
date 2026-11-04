import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// S-71: edit pages for quote/SO/PO/billing — Save changes + Cancel in a
// top bar that stays visible while scrolling, bottom buttons removed.
// (Edit pages have no Actions menu — menus live on detail pages — so the
// bar is the sticky top bar of the edit form itself.)

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("S-71 edit sticky top bar", () => {
  it("quote editor has a top bar with Save draft + Cancel, no bottom bar", () => {
    const src = read("src/components/docs/QuoteEditor.tsx");
    expect(src).toContain('className="edit-topbar"');
    expect(src).not.toContain("quote-sticky-act");
    // The bar sits before the details card, not after the tabs.
    expect(src.indexOf('className="edit-topbar"')).toBeLessThan(src.indexOf('<div className="card quote-details-card">'));
    expect(src).toContain("Save draft");
  });

  it("SO editor, PO editor and billing form have a top bar and no bottom actions", () => {
    for (const rel of ["src/components/docs/DocumentEditor.tsx", "src/components/purchasing/PoEditor.tsx"]) {
      const src = read(rel);
      expect(src).toContain('className="edit-topbar"');
      expect(src).not.toContain('className="form-actions"');
      expect(src).toContain("Save changes");
    }
    // Billing uses a submitLabel prop ("Record billing" by default).
    const billing = read("src/components/billing/BillingForm.tsx");
    expect(billing).toContain('className="edit-topbar"');
    expect(billing).not.toContain('className="form-actions"');
    expect(billing).toContain("submitLabel");
  });

  it("the top bar sticks to the top while scrolling", () => {
    const css = read("src/app/globals.css");
    const start = css.indexOf(".edit-topbar {");
    const block = css.slice(start, css.indexOf("}", start));
    expect(block).toContain("position: sticky");
    expect(block).toContain("top: 0");
  });
});
