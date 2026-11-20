import { describe, expect, it } from "vitest";
import { parseItemsCsv, applyCatalogDuplicateChecks, normalizeSku, itemNameKey } from "@/lib/items/import";
import { itemsImportEnabledFromEnv, ITEM_IMPORT_MAX_ROWS } from "@/lib/items/import-shared";

const HEADER = "name,unit,brand,model,category,sku,kind,details,defaultUnitPrice";

describe("parseItemsCsv", () => {
  it("I1 shape: a clean row parses to a schema-valid item, blanks become null", () => {
    const r = parseItemsCsv(`${HEADER}\nWidget,pc,Acme,W-1,Tools,W-001,Goods,Shiny,1500.00`);
    expect(r.fileError).toBeNull();
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.errors).toEqual([]);
    expect(r.rows[0]!.data).toMatchObject({ name: "Widget", sku: "W-001", kind: "GOODS", defaultUnitPrice: "1500.00" });
    expect(r.rows[0]!.line).toBe(2);
  });

  it("header is case-insensitive and order-free; blank kind defaults to Goods", () => {
    const r = parseItemsCsv(`Unit,Name,SKU\npc,Gadget,G-1`);
    expect(r.fileError).toBeNull();
    expect(r.rows[0]!.data).toMatchObject({ name: "Gadget", unit: "pc", kind: "GOODS", brand: null });
  });

  it("I2: a negative price flags only that row", () => {
    const r = parseItemsCsv(`${HEADER}\nGood,pc,,,,,,,\nBad,pc,,,,,,,-5`);
    expect(r.rows[0]!.errors).toEqual([]);
    expect(r.rows[1]!.errors.length).toBeGreaterThan(0);
    // The -5 row is an error row either way (formula-leading and/or schema).
    expect(r.rows[1]!.data === null || r.rows[1]!.errors.length > 0).toBe(true);
  });

  it("I2b: an over-precision price is a schema error with no data", () => {
    const r = parseItemsCsv(`${HEADER}\nBad,pc,,,,,,,10.999`);
    expect(r.rows[0]!.data).toBeNull();
    expect(r.rows[0]!.errors.join(" ")).toContain("defaultUnitPrice");
  });

  it("I3: semicolon-delimited file with ₱ prices parses exactly", () => {
    const text = "name;unit;sku;defaultUnitPrice\nWidget;pc;W-9;₱1,500.00\nGadget;box;G-9;₱ 250.5";
    const r = parseItemsCsv(text);
    expect(r.fileError).toBeNull();
    expect(r.rows[0]!.errors).toEqual([]);
    expect(r.rows[0]!.data?.defaultUnitPrice).toBe("1500.00");
    expect(r.rows[1]!.data?.defaultUnitPrice).toBe("250.5");
  });

  it("I4: duplicate SKUs inside the file flag the later row only", () => {
    const r = parseItemsCsv(`${HEADER}\nA,pc,,,,DUP,,,\nB,pc,,,,DUP,,,`);
    expect(r.rows[0]!.errors).toEqual([]);
    expect(r.rows[1]!.errors.join(" ")).toContain("Duplicate SKU");
  });

  it("I4b: duplicate SKU-less rows (name+brand+model) flag the later row", () => {
    const r = parseItemsCsv(`${HEADER}\nSame,pc,Acme,M1,,,,\nSame,pc,Acme,M1,,,,`);
    expect(r.rows[1]!.errors.join(" ")).toContain("Duplicate item");
  });

  it("I5: a file over the row cap is refused whole, nothing parsed", () => {
    const body = Array.from({ length: ITEM_IMPORT_MAX_ROWS + 1 }, (_, i) => `Item ${i},pc`).join("\n");
    const r = parseItemsCsv(`name,unit\n${body}`);
    expect(r.fileError).toContain("Too many rows");
    expect(r.rows).toEqual([]);
  });

  it("formula-leading cells are refused as error rows (R1)", () => {
    const r = parseItemsCsv(`${HEADER}\nWidget,pc,,,,,,=2+5,`);
    expect(r.rows[0]!.errors.join(" ")).toContain("formula-leading");
  });

  it("unknown columns are a file-level error", () => {
    const r = parseItemsCsv(`name,unit,secret\nA,pc,x`);
    expect(r.fileError).toContain("Unknown column");
    expect(r.rows).toEqual([]);
  });

  it("missing required columns are a file-level error", () => {
    const r = parseItemsCsv(`brand,unit\nAcme,pc`);
    expect(r.fileError).toContain("name and unit");
  });
});

describe("applyCatalogDuplicateChecks", () => {
  it("I4/I6: rows matching the catalog by SKU or name-key are flagged", () => {
    const r = parseItemsCsv(`${HEADER}\nOld,pc,,,,OLD-1,,,\nNoSku,pc,Acme,M1,,,,\nFresh,pc,,,,NEW-1,,,`);
    applyCatalogDuplicateChecks(r.rows, {
      skus: new Set([normalizeSku("old-1")]),
      nameKeys: new Set([itemNameKey("NoSku", "Acme", "M1")]),
    });
    expect(r.rows[0]!.errors.join(" ")).toContain("already exists");
    expect(r.rows[1]!.errors.join(" ")).toContain("already in the catalog");
    expect(r.rows[2]!.errors).toEqual([]);
  });
});

describe("itemsImportEnabledFromEnv", () => {
  it("mirrors the warranty flag env semantics", () => {
    expect(itemsImportEnabledFromEnv({})).toBeNull();
    expect(itemsImportEnabledFromEnv({ ITEMS_IMPORT_ENABLED: "true" })).toBe(true);
    expect(itemsImportEnabledFromEnv({ ITEMS_IMPORT_ENABLED: "0" })).toBe(false);
    expect(itemsImportEnabledFromEnv({ ITEMS_IMPORT_ENABLED: "maybe" })).toBeNull();
  });
});
