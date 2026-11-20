// Phase 4 #4: CSV import service. Runs on MySQL 8 (TEST_DATABASE_URL);
// skipped locally. Scenarios I1 (clean import), I6 (re-import flags every
// row) and I7 (confirm racing a manual create aborts, no partial write).
//
// Like the other db suites, rows are never deleted (items are never
// deleted in this app): every test uses its own unique marker in names
// and SKUs so the shared test database stays unambiguous.

import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { confirmItemsImport, previewItemsImport } from "@/lib/items/import-service";
import { saveItem } from "@/lib/services/items";
import { makeUser, tag } from "./fixtures";

const HEADER = "name,unit,brand,model,category,sku,kind,details,defaultUnitPrice";

function csvFor(marker: string, count: number, skuPrefix: string): string {
  const lines = Array.from({ length: count }, (_, i) => {
    const sku = `${skuPrefix}-${marker}-${i}`;
    return `Import Widget ${marker} ${i},pc,Acme,W-${i},Tools,${sku},Goods,,100.00`;
  });
  return `${HEADER}\n${lines.join("\n")}`;
}

describe("items CSV import service", () => {
  it("I1: a clean 10-row import creates 10 items, one batch id, exactly one audit row", async () => {
    if (!env.hasDb) return;
    const admin = await makeUser("costs");
    const marker = tag();
    const result = await confirmItemsImport(csvFor(marker, 10, "IMP1"), admin.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(10);
    expect(result.itemIds).toHaveLength(10);

    const items = await db.item.findMany({ where: { importBatchId: result.batchId } });
    expect(items).toHaveLength(10);
    expect(items.map((i) => i.id).sort()).toEqual([...result.itemIds].sort());
    expect(new Set(items.map((i) => i.importBatchId))).toEqual(new Set([result.batchId]));

    const audits = await db.auditLog.findMany({
      where: { entityType: "Item", entityId: result.batchId, action: "import" },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.userId).toBe(admin.id);
    const after = audits[0]!.after as { batchId?: string; count?: number; itemIds?: string[] };
    expect(after.batchId).toBe(result.batchId);
    expect(after.count).toBe(10);
    expect([...(after.itemIds ?? [])].sort()).toEqual([...result.itemIds].sort());
  });

  it("I6: re-importing the same file flags every row duplicate and changes nothing", async () => {
    if (!env.hasDb) return;
    const admin = await makeUser("costs");
    const marker = tag();
    const text = csvFor(marker, 4, "IMP6");
    const first = await confirmItemsImport(text, admin.id);
    expect(first.ok).toBe(true);
    const before = await db.item.count({ where: { sku: { startsWith: `IMP6-${marker}-` } } });
    expect(before).toBe(4);

    const preview = await previewItemsImport(text);
    expect(preview.fileError).toBeNull();
    expect(preview.rows).toHaveLength(4);
    for (const row of preview.rows) {
      expect(row.errors.join(" ")).toContain("Duplicate SKU");
    }

    const second = await confirmItemsImport(text, admin.id);
    expect(second.ok).toBe(false);
    const afterCount = await db.item.count({ where: { sku: { startsWith: `IMP6-${marker}-` } } });
    expect(afterCount).toBe(4);
  });

  it("I7: a manual create racing the confirm aborts it as duplicates — no partial write", async () => {
    if (!env.hasDb) return;
    const admin = await makeUser("costs");
    const marker = tag();
    const text = csvFor(marker, 3, "IMP7");

    const preview = await previewItemsImport(text);
    expect(preview.fileError).toBeNull();
    expect(preview.rows.every((r) => r.errors.length === 0)).toBe(true);

    // The manual create lands between preview and confirm, taking row 2's SKU.
    const manual = await saveItem(
      null,
      {
        name: `Manual Race ${marker}`,
        brand: null,
        model: null,
        category: null,
        sku: `IMP7-${marker}-1`,
        unit: "pc",
        kind: "GOODS",
        details: null,
        defaultUnitPrice: null,
      },
      admin.id,
    );
    expect(manual.sku).toBe(`IMP7-${marker}-1`);

    const result = await confirmItemsImport(text, admin.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const dupRow = result.rows.find((r) => r.line === 3);
    expect(dupRow?.errors.join(" ")).toContain("Duplicate SKU");

    // No partial write: only the manual item carries one of the file's SKUs,
    // and no import audit row / batch stamp exists for the aborted confirm.
    const withSkus = await db.item.findMany({ where: { sku: { startsWith: `IMP7-${marker}-` } } });
    expect(withSkus.map((i) => i.id)).toEqual([manual.id]);
    expect(withSkus[0]!.importBatchId).toBeNull();
  });
});
