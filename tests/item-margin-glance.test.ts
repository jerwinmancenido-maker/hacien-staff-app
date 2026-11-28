import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dealMargin } from "@/lib/services/profit";

// Adoption item 11 — item margin glance: the item detail's last selling
// price against its last supplier cost overall. The glance's math is the
// shared dealMargin; its cost is getItemLastCost (the Suppliers-tab
// derivation collapsed to the newest purchase). Nothing is stored.
const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const history = read("src/lib/items/history.ts");
const detail = read("src/components/ItemHistoryDetail.tsx");

describe("margin glance derivation", () => {
  it("getItemLastCost reuses the Suppliers-tab PO derivation", () => {
    expect(history).toContain("export async function getItemLastCost");
    const fn = history.slice(history.indexOf("export async function getItemLastCost"));
    // Non-void POs only, newest PO first, exact normalized-description match.
    expect(fn).toContain("db.purchaseOrderItem.findMany");
    expect(fn).toContain('status: { not: "VOID" }');
    expect(fn).toContain('orderBy: [{ purchaseOrder: { date: "desc" } }]');
    expect(fn).toContain("normalizeDescription(l.description) === want");
    // The figure stays traceable: supplier, PO number and date ride along.
    expect(fn).toContain("supplierName: first.purchaseOrder.supplier.name");
    expect(fn).toContain("poNumber: first.purchaseOrder.number");
  });

  it("stores nothing: no schema or write path is involved", () => {
    const fn = history.slice(history.indexOf("export async function getItemLastCost"));
    expect(fn).not.toContain(".create(");
    expect(fn).not.toContain(".update(");
  });
});

describe("margin glance surface and cost gating", () => {
  it("renders on the item detail only for cost viewers, with no placeholder otherwise", () => {
    expect(detail).toContain("{showCosts ? <MarginGlance description={description} last={last} /> : null}");
    expect(detail).toContain("<h2>Margin glance</h2>");
    expect(detail).toContain("getItemLastCost(description)");
    expect(detail).toContain("dealMargin(sellPrice, lastCost.lastCost)");
  });

  it("says 'no purchase yet' instead of inventing a margin", () => {
    expect(detail).toContain("No purchase yet");
  });
});

describe("margin glance math (dealMargin rules)", () => {
  it("computes margin and percent from last price over last cost", () => {
    const r = dealMargin("20000.00", "13000.00");
    expect(r.margin).toBe("7000.00");
    expect(r.marginPct).toBe("35.00");
  });

  it("shows no percent when the sell price is zero", () => {
    expect(dealMargin("0.00", "13000.00").marginPct).toBeNull();
  });

  it("shows no percent when the cost was never set (₱0.00)", () => {
    expect(dealMargin("20000.00", "0.00").marginPct).toBeNull();
  });

  it("keeps a negative margin honest", () => {
    const r = dealMargin("3000.00", "3100.00");
    expect(r.margin).toBe("-100.00");
    expect(r.marginPct).toBe("-3.33");
  });
});
