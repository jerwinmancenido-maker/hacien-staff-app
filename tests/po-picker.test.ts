import { describe, expect, it } from "vitest";
import { buildSoPickerRows, overOrder, type SoPickerLineInput } from "@/lib/purchasing/picker";

const line = (patch: Partial<SoPickerLineInput> = {}): SoPickerLineInput => ({
  id: "so-line-1",
  description: "Copper Tube 3/8\"",
  kind: "GOODS",
  qty: "10.00",
  unit: "Roll",
  supplierId: "sup-uno",
  supplierName: "UNO Management Group",
  unitCost: "3255.00",
  isLot: false,
  components: [],
  ...patch,
});

const run = (lines: SoPickerLineInput[], opts: Partial<Parameters<typeof buildSoPickerRows>[0]> = {}) =>
  buildSoPickerRows({
    lines,
    orderedLines: new Map(),
    orderedComponents: new Map(),
    poSupplierId: "sup-uno",
    onThisPo: new Set(),
    ...opts,
  });

describe("buildSoPickerRows", () => {
  it("lists an unordered line for the PO's supplier as addable with full remaining", () => {
    const rows = run([line()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "so-line-1", state: "addable", remainingQty: "10.00", orderedQty: "0.00", isComponent: false });
  });

  it("subtracts what other POs already ordered", () => {
    const rows = run([line()], { orderedLines: new Map([["so-line-1", { qty: "4.00" }]]) });
    expect(rows[0]?.remainingQty).toBe("6.00");
  });

  it("hides a fully ordered line", () => {
    expect(run([line()], { orderedLines: new Map([["so-line-1", { qty: "10.00" }]]) })).toHaveLength(0);
  });

  it("hides a line already linked on this PO (edit it in place)", () => {
    expect(run([line()], { onThisPo: new Set(["so-line-1"]) })).toHaveLength(0);
  });

  it("marks a no-supplier line as no-supplier (takes the PO's supplier)", () => {
    const rows = run([line({ supplierId: null, supplierName: null })]);
    expect(rows[0]?.state).toBe("no-supplier");
  });

  it("marks a different supplier's line as other-supplier, still listed (greyed)", () => {
    const rows = run([line({ supplierId: "sup-shopee", supplierName: "Shopee" })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("other-supplier");
    expect(rows[0]?.supplierName).toBe("Shopee");
  });

  it("never lists a lot line itself, but lists its components with the lot named", () => {
    const lot = line({
      id: "so-lot-1",
      description: "ICT Software Subscription — Lot 1",
      isLot: true,
      qty: "1.00",
      components: [
        { id: "comp-1", description: "Google Cloud Platform Services", qty: "1.00", unit: "lot", supplierId: "sup-uno", supplierName: "UNO Management Group", unitCost: "100.00" },
        { id: "comp-2", description: "Claude Max 5x Plan", qty: "2.00", unit: "Licenses", supplierId: null, supplierName: null, unitCost: "0.00" },
      ],
    });
    const rows = run([lot]);
    expect(rows.map((r) => r.key)).toEqual(["comp-1", "comp-2"]);
    expect(rows[0]).toMatchObject({ isComponent: true, parentDescription: "ICT Software Subscription — Lot 1", kind: "GOODS" });
    expect(rows[1]?.state).toBe("no-supplier");
  });

  it("hides a fully ordered component and one already on this PO", () => {
    const lot = line({
      id: "so-lot-1",
      isLot: true,
      components: [
        { id: "comp-1", description: "A", qty: "1.00", unit: "pc", supplierId: "sup-uno", supplierName: "UNO", unitCost: "1.00" },
        { id: "comp-2", description: "B", qty: "1.00", unit: "pc", supplierId: "sup-uno", supplierName: "UNO", unitCost: "1.00" },
      ],
    });
    const rows = run([lot], { orderedComponents: new Map([["comp-1", { qty: "1.00" }]]), onThisPo: new Set(["comp-2"]) });
    expect(rows).toHaveLength(0);
  });
});

describe("overOrder", () => {
  it("is true only past the remaining qty", () => {
    expect(overOrder("11", "10.00")).toBe(true);
    expect(overOrder("10", "10.00")).toBe(false);
    expect(overOrder("9.99", "10.00")).toBe(false);
    expect(overOrder("", "10.00")).toBe(false);
  });
});

describe("overOrder — render safety", () => {
  it("overOrder never throws on half-typed editor input (editor crash regression)", () => {
    expect(overOrder("2.", "1.00")).toBe(false);
    expect(overOrder(".", "1.00")).toBe(false);
    expect(overOrder("", "1.00")).toBe(false);
    expect(overOrder("abc", "1.00")).toBe(false);
    expect(overOrder("3", "2.00")).toBe(true);
    expect(overOrder("1.00", "2.00")).toBe(false);
  });
});
