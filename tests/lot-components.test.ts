// Lot (bundle) lines, Phase B1: a lot line's internal components (each
// with its own supplier and cost) drive the line's cost and margin; on
// customer prints the component DESCRIPTIONS list one per row under the
// lot line with merged qty/price cells (owner decision 2026-11-09 — see
// tests/lot-print-items.test.ts). These tests pin the money math, the
// schema rules, the planner behaviour and the editor wiring.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { componentsTotal } from "@/lib/quotes/calc";
import { itemData, planItems, type StoredItem } from "@/lib/quotes/items";
import { itemSchema } from "@/lib/validation/quotes";

const read = (p: string) => readFileSync(p, "utf8");

const LOT_INPUT = {
  id: null,
  description: "Google Cloud Platform Services",
  kind: "SERVICES" as const,
  qty: "1",
  unit: "lot",
  supplierId: null,
  supplierUnitCost: "0",
  unitPrice: "600000",
  isLot: true,
  components: [
    { id: null, itemId: null, description: "GCP subscription", qty: "1", unit: "lot", supplierId: "sup-a", unitCost: "300000" },
    { id: null, itemId: null, description: "Support hours", qty: "2", unit: "hour", supplierId: "sup-b", unitCost: "50000" },
  ],
};

describe("componentsTotal", () => {
  it("sums qty × unit cost per component, rounded like a line", () => {
    expect(
      componentsTotal([
        { qty: "2", unitCost: "1500" },
        { qty: "1", unitCost: "2750.50" },
        { qty: "2.5", unitCost: "100" },
      ]),
    ).toBe("6000.50");
    expect(componentsTotal([])).toBe("0.00");
  });
});

describe("itemSchema lot rules", () => {
  const base = { description: "Lot line", kind: "SERVICES" as const, qty: "1", unit: "lot", unitPrice: "600000" };

  it("accepts a lot with at least one component", () => {
    const parsed = itemSchema.safeParse({ ...base, isLot: true, components: LOT_INPUT.components });
    expect(parsed.success).toBe(true);
  });

  it("rejects a lot with no components", () => {
    const parsed = itemSchema.safeParse({ ...base, isLot: true, components: [] });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.some((i) => i.message.includes("at least one component"))).toBe(true);
  });

  it("rejects components on a normal line", () => {
    const parsed = itemSchema.safeParse({ ...base, components: LOT_INPUT.components });
    expect(parsed.success).toBe(false);
  });

  it("rejects a component with zero qty", () => {
    const parsed = itemSchema.safeParse({
      ...base,
      isLot: true,
      components: [{ description: "X", qty: "0", unit: "pc", unitCost: "10" }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("planItems lot planning", () => {
  it("costs a lot from its components and clears the line's own supplier/cost", () => {
    const { items } = planItems([], [LOT_INPUT], true, { lots: true });
    const line = items[0]!;
    expect(line.isLot).toBe(true);
    expect(line.total).toBe("600000.00");
    expect(line.supplierTotal).toBe("400000.00");
    expect(line.margin).toBe("200000.00");
    expect(line.supplierId).toBeNull();
    expect(line.supplierUnitCost).toBe("0");
    expect(line.components).toHaveLength(2);
  });

  it("forces a lot's qty to 1 even when the payload says otherwise (audit D1)", () => {
    // A lot's price is the price of ONE bundle and Create POs orders the
    // components' quantities unscaled — qty 2 would sell two bundles and
    // buy one bundle's parts.
    const { items } = planItems([], [{ ...LOT_INPUT, qty: "2" }], true, { lots: true });
    const line = items[0]!;
    expect(line.qty).toBe("1");
    expect(line.total).toBe("600000.00");
    // A stored lot self-heals the same way on a no-costs save.
    const stored: StoredItem[] = [
      { id: "line-9", kind: "SERVICES", supplierId: null, supplierUnitCost: "0", isLot: true, components: LOT_INPUT.components },
    ];
    const healed = planItems(stored, [{ ...LOT_INPUT, id: "line-9", qty: "3", isLot: undefined, components: undefined }], false, { lots: true });
    expect(healed.items[0]!.qty).toBe("1");
  });

  it("without the lots opt-in (the sales-order path) the same input plans as a normal line", () => {
    const { items } = planItems([], [LOT_INPUT], true);
    const line = items[0]!;
    expect(line.isLot).toBe(false);
    expect(line.components).toHaveLength(0);
    expect(line.supplierTotal).toBe("0.00");
  });

  it("a no-costs save keeps a stored lot and its components untouched", () => {
    const stored: StoredItem[] = [
      {
        id: "line-1",
        kind: "SERVICES",
        supplierId: null,
        supplierUnitCost: "0",
        isLot: true,
        components: [
          { itemId: null, description: "GCP subscription", qty: "1", unit: "lot", supplierId: "sup-a", unitCost: "300000" },
          { itemId: null, description: "Support hours", qty: "2", unit: "hour", supplierId: "sup-b", unitCost: "50000" },
        ],
      },
    ];
    const input = { ...LOT_INPUT, id: "line-1", isLot: undefined, components: undefined };
    const { items } = planItems(stored, [input], false, { lots: true });
    const line = items[0]!;
    expect(line.isLot).toBe(true);
    expect(line.supplierTotal).toBe("400000.00");
    expect(line.components.map((c) => c.description)).toEqual(["GCP subscription", "Support hours"]);
  });

  it("itemData stays SO-safe: no isLot/components keys leak into shared row data", () => {
    const { items } = planItems([], [LOT_INPUT], true, { lots: true });
    const data = itemData(items[0]!);
    expect("isLot" in data).toBe(false);
    expect("components" in data).toBe(false);
  });
});

describe("editor wiring", () => {
  it("the quote editor has the lot toggle, the components editor and the lot payload", () => {
    const editor = read("src/components/docs/QuoteEditor.tsx");
    expect(editor.match(/Lot \(bundle\) — items listed on the print under one lot price/g)).toHaveLength(2); // desktop + mobile
    expect(editor).toContain("toggleLot");
    expect(editor).toContain("Add component");
    expect(editor).toContain("lineCostMissing");
    // Lot lines skip the catalog picker on their own description (spec text).
    expect(editor).toContain("if (line.itemId || line.isLot) return;");
  });

  it("the SO editor does not grow a lot toggle", () => {
    expect(read("src/components/docs/DocumentEditor.tsx")).not.toContain("toggleLot");
  });
});
