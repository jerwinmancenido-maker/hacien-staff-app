import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CreatePosForm, type PreviewLine } from "@/components/purchasing/CreatePosForm";
import { planPoSelection, selectionIssueSummary, type PoSelectionInput } from "@/lib/purchasing/plan";

const row = (extra: Partial<PoSelectionInput> = {}): PoSelectionInput => ({
  key: "l1",
  salesOrderItemId: "l1",
  description: "Laptop",
  kind: "GOODS",
  qty: "10",
  unit: "pc",
  unitCost: "45000.00",
  supplierId: "A",
  quoteSupplierId: "A",
  sortOrder: 1,
  confirmZero: false,
  remainingQty: "10.00",
  ...extra,
});

describe("planPoSelection", () => {
  it("groups by the final supplier and keeps the quote cost when the supplier changes", () => {
    const plan = planPoSelection([
      row({ key: "l1", salesOrderItemId: "l1", sortOrder: 1, supplierId: "B", quoteSupplierId: "A", unitCost: "45000", description: "Laptop" }),
      row({ key: "l2", salesOrderItemId: "l2", sortOrder: 2, supplierId: "A", quoteSupplierId: "A", unitCost: "500.00", description: "Mouse" }),
      row({ key: "l3", salesOrderItemId: "l3", sortOrder: 3, supplierId: "B", quoteSupplierId: "B", unitCost: "12000.50", description: "Printer" }),
    ]);
    expect(plan.issues).toEqual([]);
    expect(plan.pos.map((p) => p.supplierId)).toEqual(["B", "A"]);
    const moved = plan.pos[0]!.lines.find((l) => l.key === "l1")!;
    expect(moved.unitCost).toBe("45000.00");
    expect(moved.quoteSupplierId).toBe("A");
    expect(plan.pos[0]!.lines.map((l) => l.key)).toEqual(["l1", "l3"]);
    expect(plan.pos[1]!.lines.map((l) => l.key)).toEqual(["l2"]);
  });

  it("keeps a lot component on its own line, grouped by the chosen supplier", () => {
    const plan = planPoSelection([
      row({
        key: "c1",
        salesOrderItemId: "lot",
        salesOrderItemComponentId: "c1",
        description: "Whiteboard",
        supplierId: "B",
        quoteSupplierId: "A",
        unitCost: "3200",
        qty: "5",
        remainingQty: "5.00",
        lotDescription: "Classroom kit",
        sortOrder: 1,
      }),
    ]);
    expect(plan.issues).toEqual([]);
    expect(plan.pos[0]!.lines[0]).toMatchObject({
      salesOrderItemId: "lot",
      salesOrderItemComponentId: "c1",
      unitCost: "3200.00",
      qty: "5.00",
      lotDescription: "Classroom kit",
    });
  });

  it("refuses a missing supplier, an unconfirmed ₱0 cost, and a qty over the remainder", () => {
    const plan = planPoSelection([
      row({ key: "none", supplierId: "", quoteSupplierId: null, unitCost: "10.00" }),
      row({ key: "zero", supplierId: "A", quoteSupplierId: null, unitCost: "0.00", confirmZero: false, sortOrder: 2 }),
      row({ key: "over", qty: "3", remainingQty: "2.00", sortOrder: 3 }),
      row({ key: "bad", qty: "1.234", sortOrder: 4 }),
      row({ key: "done", qty: "1", remainingQty: "0.00", sortOrder: 5 }),
      row({ key: "ok", qty: "2", remainingQty: "2.00", unitCost: "0", confirmZero: true, supplierId: "A", quoteSupplierId: null, sortOrder: 6 }),
    ]);
    expect(plan.pos.map((p) => p.lines.map((l) => l.key))).toEqual([["ok"]]);
    expect(plan.pos[0]!.lines[0]!.unitCost).toBe("0.00");
    expect(plan.issues.map((i) => [i.key, i.code])).toEqual([
      ["none", "missing"],
      ["zero", "zero"],
      ["over", "qty"],
      ["bad", "qty"],
      ["done", "qty"],
    ]);
    expect(plan.issues.find((i) => i.key === "over")!.message).toMatch(/2 left/);
    expect(plan.issues.find((i) => i.key === "done")!.message).toMatch(/fully ordered/);
    expect(selectionIssueSummary(plan.issues, "review")).toBe(
      "Can't review yet: 1 line needs a supplier, 1 line at ₱0.00 needs a per-line cost confirmation, and 3 lines have a qty that can't be ordered.",
    );
  });
});

const previewLine = (extra: Partial<PreviewLine> = {}): PreviewLine => ({
  id: "l1",
  sortOrder: 1,
  description: "Laptop i5",
  kind: "GOODS",
  qty: "10.00",
  unit: "pc",
  supplierId: "sup-a",
  supplierName: "UNO",
  supplierUnitCost: "45000.00",
  orderedQty: "8.00",
  remainingQty: "2.00",
  purchaseOrders: [{ id: "po1", number: "PO-2026-0012", qty: "8.00" }],
  purchaseOrder: { id: "po1", number: "PO-2026-0012" },
  ...extra,
});

describe("CreatePosForm selection screen", () => {
  it("renders a supplier select on every open row, the remainder, and a locked fully-ordered line", () => {
    const html = renderToStaticMarkup(
      createElement(CreatePosForm, {
        soNumber: "SO-1",
        customerName: "Example Customer",
        suppliers: [
          { id: "sup-a", name: "UNO" },
          { id: "sup-b", name: "Shopee PH" },
        ],
        defaultDate: "2026-11-10",
        defaultAddress: "Example street",
        cancelHref: "/sales-orders/so1",
        action: async () => ({ ok: true }),
        lines: [
          previewLine(),
          previewLine({
            id: "l2",
            sortOrder: 2,
            description: "USB Flash Drive",
            supplierId: null,
            supplierName: null,
            supplierUnitCost: "0.00",
            orderedQty: "0.00",
            remainingQty: "50.00",
            qty: "50.00",
            purchaseOrders: [],
            purchaseOrder: null,
          }),
          previewLine({
            id: "l3",
            sortOrder: 3,
            description: "Printer",
            orderedQty: "2.00",
            remainingQty: "0.00",
            qty: "2.00",
            purchaseOrders: [{ id: "po2", number: "PO-2026-0011", qty: "2.00" }],
            purchaseOrder: { id: "po2", number: "PO-2026-0011" },
          }),
          {
            id: "lot",
            sortOrder: 4,
            description: "Classroom kit",
            kind: "GOODS",
            qty: "1.00",
            unit: "lot",
            supplierId: null,
            supplierName: null,
            supplierUnitCost: "0.00",
            orderedQty: "0.00",
            remainingQty: "0.00",
            purchaseOrders: [],
            purchaseOrder: null,
            isLot: true,
            components: [
              {
                id: "c1",
                sortOrder: 1,
                description: "Whiteboard",
                qty: "5.00",
                unit: "pc",
                supplierId: "sup-a",
                supplierName: "UNO",
                unitCost: "3200.00",
                orderedQty: "0.00",
                remainingQty: "5.00",
                purchaseOrders: [],
                purchaseOrder: null,
              },
            ],
          },
        ],
      }),
    );
    expect(html).toContain("Items to order");
    expect(html).toContain("8 of 10 on");
    expect(html).toContain("PO-2026-0012");
    expect(html).toContain('aria-label="Supplier Laptop i5"');
    expect(html).toContain('aria-label="Supplier USB Flash Drive"');
    expect(html).toContain('aria-label="Supplier Whiteboard"');
    expect(html).toContain("Select supplier…");
    expect(html).toContain("Confirm ₱0.00 cost");
    expect(html).toContain("no cost — blocks create");
    expect(html).toContain("Fully ordered");
    expect(html).toContain("LOT");
    expect(html).toContain("Classroom kit");
    expect(html).toContain("max 2 left");
    expect(html).toContain("&quot;key&quot;:&quot;l1&quot;");
    expect(html).toContain("&quot;supplierId&quot;:&quot;sup-a&quot;");
    expect(html).toContain("&quot;qty&quot;:&quot;2&quot;");
    expect(html).not.toContain("&quot;key&quot;:&quot;l3&quot;");
  });
});
