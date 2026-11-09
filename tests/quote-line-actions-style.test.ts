import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Compact lines Phase 1 (Jerwin, 2026-11-08): the button row under a quote
// line is gone — no "Pick a product", no "Product details" button. Typing
// in the search box is the only picker entry; under the box sits a quiet
// caption (productMeta) only when the line is linked or carries a pending
// new product. This replaces the item-1 guard for the old button row.
const editor = readFileSync(
  path.join(process.cwd(), "src/components/docs/QuoteEditor.tsx"),
  "utf8",
);
const meta = editor.slice(
  editor.indexOf("function productMeta"),
  editor.indexOf("const move =", editor.indexOf("function productMeta")),
);

describe("quote line has no product button row, only a quiet caption", () => {
  it("the old productRow and its buttons are removed", () => {
    expect(editor).not.toContain("function productRow");
    expect(editor).not.toContain("Pick a product");
    expect(editor).not.toContain("quote-ln-product");
  });

  it("the linked caption opens the drawer and can unlink", () => {
    expect(meta).toContain("🔗 Linked · {line.itemName ?? \"Linked product\"}");
    expect(meta).toContain('aria-label="Unlink product"');
    expect(meta).toContain("openDrawer(line)");
  });

  it("a pending new product shows the will-be-added caption", () => {
    expect(meta).toContain("will be added to Products when saved");
  });

  it("a plain free-text line renders no caption", () => {
    expect(meta).toContain("return null;");
  });
});
