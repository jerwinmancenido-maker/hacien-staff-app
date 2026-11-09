// Lot grouping moves (2026-11-09): the pure editor-state conversions
// behind "Move to…" — a line becomes a lot member (cost only), a member
// moves between lots, a member moves back out as a fresh line.
import { describe, expect, it } from "vitest";
import {
  lotNumberOf,
  lotTargets,
  moveComponentOut,
  moveComponentToLot,
  moveLineIntoLot,
  type LotComponentShape,
  type LotLineShape,
} from "@/lib/quotes/lot-moves";

type Line = LotLineShape & { unitPrice: string };
type Comp = LotComponentShape;

const comp = (key: string, description: string, extra: Partial<Comp> = {}): Comp => ({
  key,
  id: null,
  itemId: null,
  description,
  qty: "1",
  unit: "pc",
  supplierId: null,
  unitCost: "10",
  ...extra,
});

const line = (key: string, description: string, extra: Partial<Line> = {}): Line => ({
  key,
  itemId: null,
  description,
  qty: "1",
  unit: "pc",
  supplierId: null,
  supplierUnitCost: "5",
  unitPrice: "100",
  ...extra,
});

const lot = (key: string, description: string, components: Comp[]): Line => ({
  ...line(key, description, { unitPrice: "1000" }),
  isLot: true,
  qty: "1",
  unit: "lot",
  components,
});

function fixture(): Line[] {
  return [
    lot("lot-a", "Lot A", [comp("c-1", "Inside A")]),
    line("free-1", "Loose item", { itemId: "item-9", qty: "2", unit: "Licenses", supplierId: "sup-1", supplierUnitCost: "42" }),
    lot("lot-b", "Lot B", []),
    line("free-2", "Another loose"),
  ];
}

describe("lot numbering and targets", () => {
  it("numbers lots in quote order and lists move targets", () => {
    const items = fixture();
    expect(lotNumberOf(items, "lot-a")).toBe(1);
    expect(lotNumberOf(items, "lot-b")).toBe(2);
    expect(lotNumberOf(items, "free-1")).toBe(0);
    expect(lotTargets(items)).toEqual([
      { key: "lot-a", n: 1 },
      { key: "lot-b", n: 2 },
    ]);
    expect(lotTargets(items, "lot-a")).toEqual([{ key: "lot-b", n: 2 }]);
  });
});

describe("moveLineIntoLot", () => {
  it("converts the line into a component, carrying link/qty/unit/supplier/cost and dropping the price", () => {
    const out = moveLineIntoLot(fixture(), "free-1", "lot-b");
    expect(out.map((i) => i.key)).toEqual(["lot-a", "lot-b", "free-2"]);
    const target = out.find((i) => i.key === "lot-b")!;
    expect(target.components).toHaveLength(1);
    const c = target.components![0]!;
    expect(c).toEqual({
      key: "free-1",
      id: null,
      itemId: "item-9",
      description: "Loose item",
      qty: "2",
      unit: "Licenses",
      supplierId: "sup-1",
      unitCost: "42",
    });
    expect("unitPrice" in c).toBe(false);
  });

  it("refuses to move a lot into a lot and ignores unknown keys", () => {
    const items = fixture();
    expect(moveLineIntoLot(items, "lot-a", "lot-b").map((i) => i.key)).toEqual(items.map((i) => i.key));
    expect(moveLineIntoLot(items, "nope", "lot-b")).toHaveLength(4);
  });
});

describe("moveComponentToLot", () => {
  it("moves a member between lots, appended last", () => {
    const out = moveComponentToLot(fixture(), "lot-a", "c-1", "lot-b");
    expect(out.find((i) => i.key === "lot-a")!.components).toHaveLength(0);
    expect(out.find((i) => i.key === "lot-b")!.components!.map((c) => c.key)).toEqual(["c-1"]);
  });

  it("is a no-op for the same lot or an unknown component", () => {
    const items = fixture();
    expect(moveComponentToLot(items, "lot-a", "c-1", "lot-a")).toEqual(items);
    expect(moveComponentToLot(items, "lot-a", "nope", "lot-b")).toEqual(items);
  });
});

describe("moveComponentOut", () => {
  it("builds a fresh line from the component, right after the lot", () => {
    const out = moveComponentOut(fixture(), "lot-a", "c-1", (c) => ({
      ...line("new-line", c.description),
      itemId: c.itemId,
      qty: c.qty,
      unit: c.unit,
      supplierId: c.supplierId,
      supplierUnitCost: c.unitCost,
      unitPrice: "",
    }));
    expect(out.map((i) => i.key)).toEqual(["lot-a", "new-line", "free-1", "lot-b", "free-2"]);
    expect(out.find((i) => i.key === "lot-a")!.components).toHaveLength(0);
    const fresh = out.find((i) => i.key === "new-line")!;
    expect(fresh.description).toBe("Inside A");
    expect(fresh.unitPrice).toBe("");
  });
});
