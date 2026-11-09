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
    // 2026-11-09: an all-blank marker still creates the item on save, so the
    // 191-char name guard applies to it too; a short description passes.
    const blankMarker = { ...base, newCatalog: { brand: "", model: "", category: "", sku: "", details: "" } };
    expect(itemSchema.safeParse(blankMarker).success).toBe(true);
    const blankLong = { ...blankMarker, description: "x".repeat(192) };
    expect(itemSchema.safeParse(blankLong).success).toBe(false);
    // A linked line never creates, so its long description is fine.
    const linkedLong = { ...blankMarker, itemId: "item-1", description: "x".repeat(500) };
    expect(itemSchema.safeParse(linkedLong).success).toBe(true);
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
    // 2026-11-09: the payload sends the marker whenever the drawer marked
    // the line — blank fields still create the item (the old
    // "newCatalog: hasCatalogFields" gate is gone).
    expect(editor).toContain("newCatalog: nc");
    expect(editor).not.toContain("hasCatalogFields");
    // Opening the drawer is what sets the marker.
    expect(editor).toContain("line.newCatalog == null");
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
