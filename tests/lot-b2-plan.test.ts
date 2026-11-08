import { describe, expect, it } from "vitest";
import { planPurchaseOrders, type SoLineForPo } from "@/lib/purchasing/plan";
import { planItems, type StoredItem } from "@/lib/quotes/items";

// Lot Phase B2 — the PO planner buys lot COMPONENTS (grouped by the
// component's supplier), and planItems preserves stored lots on SO saves.
const LOT_LINE: SoLineForPo = {
  id: "so-lot",
  sortOrder: 1,
  description: "Google Cloud Platform Services",
  kind: "SERVICES",
  qty: "1",
  unit: "lot",
  supplierId: null,
  supplierUnitCost: "0",
  isLot: true,
  components: [
    { id: "comp-a", sortOrder: 1, description: "GCP subscription", qty: "1", unit: "lot", supplierId: "sup-a", unitCost: "300000" },
    { id: "comp-b", sortOrder: 2, description: "Support hours", qty: "2", unit: "hour", supplierId: "sup-b", unitCost: "50000" },
  ],
};

const NORMAL_LINE: SoLineForPo = {
  id: "so-normal",
  sortOrder: 2,
  description: "Laptop i5",
  kind: "GOODS",
  qty: "10",
  unit: "pc",
  supplierId: "sup-a",
  supplierUnitCost: "45000",
};

describe("planPurchaseOrders with lot lines", () => {
  it("expands a lot into one PO line per component, grouped by component supplier", () => {
    const plan = planPurchaseOrders([LOT_LINE, NORMAL_LINE], new Set());
    expect(plan.pos).toHaveLength(2);
    const poA = plan.pos.find((p) => p.supplierId === "sup-a")!;
    const poB = plan.pos.find((p) => p.supplierId === "sup-b")!;
    // sup-a gets the component AND the normal line.
    expect(poA.lines).toHaveLength(2);
    const compLine = poA.lines.find((l) => l.salesOrderItemComponentId === "comp-a")!;
    expect(compLine.salesOrderItemId).toBe("so-lot");
    expect(compLine.description).toBe("GCP subscription");
    expect(compLine.kind).toBe("SERVICES");
    expect(compLine.unitCost).toBe("300000");
    expect(poB.lines).toHaveLength(1);
    expect(poB.lines[0]!.qty).toBe("2");
    expect(poB.lines[0]!.unitCost).toBe("50000");
    expect(plan.needsSupplier).toHaveLength(0);
    expect(plan.alreadyOrdered).toHaveLength(0);
  });

  it("a component without a supplier needs one, keyed by the component id", () => {
    const lot: SoLineForPo = {
      ...LOT_LINE,
      components: [{ id: "comp-x", sortOrder: 1, description: "Mystery part", qty: "1", unit: "pc", supplierId: null, unitCost: "100" }],
    };
    const plan = planPurchaseOrders([lot], new Set());
    expect(plan.pos).toHaveLength(0);
    expect(plan.needsSupplier).toHaveLength(1);
    expect(plan.needsSupplier[0]!.id).toBe("comp-x");
    const picked = planPurchaseOrders([lot], new Set(), { "comp-x": "sup-a" });
    expect(picked.pos).toHaveLength(1);
    expect(picked.pos[0]!.lines[0]!.salesOrderItemComponentId).toBe("comp-x");
  });

  it("ordered components are skipped; a fully ordered lot reads as already ordered", () => {
    const partial = planPurchaseOrders([LOT_LINE], new Set(), {}, undefined, new Set(["comp-a"]));
    expect(partial.pos).toHaveLength(1);
    expect(partial.pos[0]!.supplierId).toBe("sup-b");
    expect(partial.alreadyOrdered).toHaveLength(0);
    const full = planPurchaseOrders([LOT_LINE], new Set(), {}, undefined, new Set(["comp-a", "comp-b"]));
    expect(full.pos).toHaveLength(0);
    expect(full.alreadyOrdered.map((l) => l.id)).toEqual(["so-lot"]);
  });

  it("excluded components and the only-filter apply per component / per lot line", () => {
    const excluded = planPurchaseOrders([LOT_LINE], new Set(), {}, undefined, new Set(), new Set(["comp-b"]));
    expect(excluded.pos).toHaveLength(1);
    expect(excluded.pos[0]!.lines[0]!.salesOrderItemComponentId).toBe("comp-a");
    const onlyNormal = planPurchaseOrders([LOT_LINE, NORMAL_LINE], new Set(), {}, new Set(["so-normal"]));
    expect(onlyNormal.pos).toHaveLength(1);
    expect(onlyNormal.pos[0]!.lines[0]!.salesOrderItemId).toBe("so-normal");
  });
});

describe("planItems preserveLots (the sales-order save path)", () => {
  const stored: StoredItem[] = [
    {
      id: "so-item-1",
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
  const payload = [
    {
      id: "so-item-1",
      description: "Google Cloud Platform Services",
      kind: "SERVICES" as const,
      qty: "1",
      unit: "lot",
      // The SO editor sends the line's (zero) cost fields; they must not win.
      supplierId: "sup-a",
      supplierUnitCost: "999",
      unitPrice: "650000",
    },
  ];

  it("keeps the stored components and costs, takes the new price", () => {
    const { items } = planItems(stored, payload, true, { preserveLots: true });
    const line = items[0]!;
    expect(line.isLot).toBe(true);
    expect(line.components).toHaveLength(2);
    expect(line.supplierTotal).toBe("400000.00");
    expect(line.total).toBe("650000.00");
    expect(line.margin).toBe("250000.00");
    expect(line.supplierId).toBeNull();
    expect(line.supplierUnitCost).toBe("0");
  });

  it("without preserveLots the same payload plans as a normal line (quotes never pass it)", () => {
    const { items } = planItems(stored, payload, true, {});
    const line = items[0]!;
    expect(line.isLot).toBe(false);
    expect(line.components).toHaveLength(0);
    expect(line.supplierUnitCost).toBe("999");
  });
});
