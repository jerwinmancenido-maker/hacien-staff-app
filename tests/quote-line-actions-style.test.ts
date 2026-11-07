import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// UI tidy-up item 1 (Jerwin, 2026-11-07): the actions under a quote line
// ("Pick a product", the linked-product chip, unlink, "Product details") are
// small quiet secondary buttons like "Add line" — same labels, same handlers,
// no longer underlined text links.
const editor = readFileSync(
  path.join(process.cwd(), "src/components/docs/QuoteEditor.tsx"),
  "utf8",
);
const productRow = editor.slice(
  editor.indexOf("function productRow"),
  editor.indexOf("const move =", editor.indexOf("function productRow")),
);

describe("quote line product actions are small secondary buttons", () => {
  it("productRow renders no btn-link buttons", () => {
    expect(productRow).not.toContain("btn-link");
  });

  it("all four actions use the Add line button classes", () => {
    const matches = productRow.match(/btn btn-secondary btn-sm/g) ?? [];
    expect(matches.length).toBe(4);
  });

  it("labels and handlers are unchanged", () => {
    expect(productRow).toContain("Pick a product");
    expect(productRow).toContain("Product details");
    expect(productRow).toContain('aria-label="Unlink product"');
    expect(productRow).toContain("🔗 {line.itemName ?? \"Linked product\"}");
    expect(productRow).toContain("setPickerFor(line.key)");
    expect(productRow).toContain("openDrawer(line)");
  });
});
