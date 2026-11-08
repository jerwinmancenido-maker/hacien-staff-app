import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), "utf8");

import { itemSchema } from "@/lib/validation/quotes";
import { itemData, planItems } from "@/lib/quotes/items";

describe("catalog Step 3: picker, drawer and catalog link", () => {
  it("a line typed with catalog fields needs a description that fits a catalog name", () => {
    const base = {
      id: null,
      description: "Short name",
      kind: "GOODS" as const,
      qty: "1",
      unit: "pc",
      supplierId: null,
      supplierUnitCost: "0",
      unitPrice: "100",
    };
    const withFields = { ...base, newCatalog: { brand: "Acme", model: "X", category: "", sku: "", details: "" } };
    expect(itemSchema.safeParse(withFields).success).toBe(true);
    const long = { ...withFields, description: "x".repeat(192) };
    const parsed = itemSchema.safeParse(long);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]!.message).toContain("191");
    const plain = { ...base, description: "x".repeat(500) };
    expect(itemSchema.safeParse(plain).success).toBe(true);
  });

  it("planItems carries the link through, treats blank as unlinked, and itemData stays SO-safe", () => {
    const linked = planItems([], [{ id: null, description: "A", kind: "GOODS", qty: "1", unit: "pc", supplierId: null, itemId: "item-1", supplierUnitCost: "0", unitPrice: "10" }], true);
    expect(linked.items[0]!.itemId).toBe("item-1");
    const blank = planItems([], [{ id: null, description: "A", kind: "GOODS", qty: "1", unit: "pc", supplierId: null, itemId: "", supplierUnitCost: "0", unitPrice: "10" }], true);
    expect(blank.items[0]!.itemId).toBeNull();
    // itemData is shared with sales orders, whose lines have no itemId column.
    expect("itemId" in itemData(linked.items[0]!)).toBe(false);
  });

  it("the editor wires the picker, the drawer and the save payload", () => {
    const editor = src("src/components/docs/QuoteEditor.tsx");
    // Phase 1 (2026-11-08): typing opens the picker — there is no
    // "Pick a product" button; the drawer is "Add to Products" in create
    // mode and "Product details" for a linked line.
    expect(editor).not.toContain("Pick a product");
    expect(editor).toContain("Product details");
    expect(editor).toContain("Add to Products");
    expect(editor).toContain("applyCatalogPick");
    expect(editor).toContain("/api/items/search?q=");
    expect(editor).toContain("Open in catalog");
    expect(editor).toContain("itemId: i.itemId");
    expect(editor).toContain("newCatalog: hasCatalogFields");
    expect(editor).toContain("No product found for");
    expect(editor).toContain("this saves as a free-text line.");
  });

  it("the search and item routes exist and are staff-only", () => {
    const search = src("src/app/api/items/search/route.ts");
    expect(search).toContain("searchCatalogItems");
    expect(search).toContain('requirePagePermission("view")');
    const one = src("src/app/api/items/[id]/route.ts");
    expect(one).toContain("findUnique");
    expect(one).toContain('requirePagePermission("view")');
  });
});
