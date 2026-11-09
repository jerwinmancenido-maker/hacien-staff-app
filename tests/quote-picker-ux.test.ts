import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { desktopCss } from "./desktop-css";

// UI tidy-up item 5 (Jerwin, 2026-11-07): the catalog picker becomes a real
// dropdown anchored under the description input, gains an inline add row
// that opens the product drawer in create mode, and Product details opens
// as a right slide-over instead of a centered modal. Compact lines Phase 1
// (2026-11-08) renamed the add row to "+ Add to Products", made the drawer
// title depend on the mode, and changed the empty-state wording.
// Source-level guards (the editor is a client component).
const editor = readFileSync(path.join(process.cwd(), "src/components/docs/QuoteEditor.tsx"), "utf8");
const dialogs = readFileSync(path.join(process.cwd(), "src/components/docs/Dialogs.tsx"), "utf8");
const css = desktopCss(readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8"));

const pickerBox = editor.slice(editor.indexOf("function pickerBox"), editor.indexOf("function productMeta"));
const cssRule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
};

describe("catalog picker dropdown is anchored to the description input", () => {
  it("both line layouts wrap the textarea and picker in the anchor wrapper", () => {
    const wraps = editor.match(/<div className="quote-ln-descwrap">/g) ?? [];
    expect(wraps.length).toBe(2);
    expect(editor.match(/\{pickerBox\(i\)\}/g)?.length).toBe(2);
  });

  it("the wrapper is positioned and the picker is an absolute overlay under it", () => {
    expect(cssRule(".quote-ln-descwrap")).toContain("position: relative");
    const picker = cssRule(".quote-picker");
    expect(picker).toContain("position: absolute");
    expect(picker).toContain("top: calc(100% + 4px)");
    expect(picker).toContain("z-index: 30");
    expect(picker).not.toContain("margin-top");
  });
});

describe("picker has an inline add-new-item row", () => {
  it("renders the Add to Products row and opens the drawer", () => {
    expect(pickerBox).toContain("quote-picker-add");
    expect(pickerBox).toContain("+ Add to Products");
    expect(pickerBox).toContain("openDrawer(line)");
    expect(pickerBox).toContain("pickerQuery.trim()");
  });

  it("still offers the matches list and the free-text empty state", () => {
    expect(pickerBox).toContain("applyCatalogPick(line, r)");
    expect(pickerBox).toContain("No product found for");
    expect(pickerBox).toContain("this saves as a free-text line.");
  });
});

describe("product details opens as a right slide-over", () => {
  it("only the product details modal uses the drawer variant", () => {
    expect(editor.match(/variant="drawer-right"/g)?.length).toBe(1);
    expect(editor).toContain('<Modal title={line.itemId ? "Product details" : "Add to Products"} labelId="product-details-title" variant="drawer-right"');
  });

  it("the shared Modal renders the drawer classes only for that variant", () => {
    expect(dialogs).toContain('variant?: "drawer-right"');
    expect(dialogs).toContain('"modal-backdrop drawer"');
    expect(dialogs).toContain('"modal wide drawer-right"');
    expect(dialogs).toContain('"modal wide"');
  });

  it("the drawer is pinned to the right edge at full height", () => {
    expect(cssRule(".modal-backdrop.drawer")).toContain("place-items: stretch end");
    const drawer = cssRule(".modal.drawer-right");
    expect(drawer).toContain("border-radius: 0");
    expect(drawer).toContain("overflow-y: auto");
  });
});
