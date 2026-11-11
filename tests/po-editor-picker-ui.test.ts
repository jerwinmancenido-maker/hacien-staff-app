// Part B — PO editor picker: source pins for the "Add from sales order"
// button + panel, the second Add line button, link ids in the payload, the
// "Changed vs SO" marker and the over-order warning. Behaviour of the row
// builder itself is covered in tests/po-picker.test.ts; the service rules in
// tests/db/po-picker.db.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const editor = readFileSync("src/components/purchasing/PoEditor.tsx", "utf8");
const editPage = readFileSync("src/app/(app)/purchase-orders/[id]/edit/page.tsx", "utf8");
const service = readFileSync("src/lib/services/purchase-orders.ts", "utf8");
const views = readFileSync("src/lib/purchasing/views.ts", "utf8");

describe("PO editor — Add from sales order (Part B)", () => {
  it("has the picker button beside Add line, gated on soPicker", () => {
    expect(editor).toContain("Add from sales order");
    expect(editor).toContain("{soPicker && (");
    expect(editor).toContain("aria-expanded={pickerOpen}");
  });

  it("states the supplier rules in plain words inside the panel", () => {
    expect(editor).toContain("No supplier on the order. Will be bought from");
    expect(editor).toContain("it needs its own purchase order");
    expect(editor).toContain("Nothing left to add from this sales order.");
  });

  it("confirms a zero cost before adding (audit B5)", () => {
    expect(editor).toContain("has no cost yet. Add it at ₱0.00?");
  });

  it("warns on over-order in the picker and on the added line, never blocks", () => {
    expect(editor).toContain("More than what is left — saved as an extra.");
    expect(editor).toContain("More than what is left on the sales order");
  });

  it("shows the Changed vs sales order marker with the SO values", () => {
    expect(editor).toContain("Changed vs sales order — SO:");
  });

  it("carries the link ids in the save payload", () => {
    expect(editor).toContain("salesOrderItemId: i.salesOrderItemId ?? null");
    expect(editor).toContain("salesOrderItemComponentId: i.salesOrderItemComponentId ?? null");
  });

  it("keeps a second Add line button below the items table (extras like freight)", () => {
    expect(editor.match(/Add line/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("the edit page passes the picker data through", () => {
    expect(editPage).toContain("soPicker={po.soPicker}");
  });

  it("the service locks the SO before the PO and records picker adds in the audit (B1/B5)", () => {
    // The raw SQL in the source escapes its backticks (\`) — match that form.
    expect(service).toContain("FROM \\`SalesOrder\\`");
    expect(service.indexOf("FROM \\`SalesOrder\\`")).toBeLessThan(service.indexOf("const before = await lockPurchaseOrder(tx, id);", service.indexOf("updatePurchaseOrder")));
    expect(service).toContain("addedFromSalesOrder: addedFromSo");
    expect(service).toContain("belongs to a different supplier");
  });

  it("the edit view builds picker rows from the ONE ordered-qty helper (B4)", () => {
    expect(views).toContain("buildSoPickerRows");
    expect(views).toContain("orderedLines: ordered.lines");
  });
});

describe("PO editor — qty-edit crash + in-editor over-order warning (REQ-192-PO-EDITOR-QTY)", () => {
  it("render-time comparisons never call raw toScaled on live qty input", () => {
    expect(editor).toContain("function changedVsSo(i: Row): boolean");
    expect(editor).toContain("changedVsSo(i) && (");
    expect(editor).not.toContain('toScaled(i.qty || "0", 2) !== toScaled(i.soQty, 2)');
  });

  it("edit data carries remainingQty for existing lines via remainingQtyForExistingPoLine", () => {
    expect(views).toContain("remainingQtyForExistingPoLine");
    expect(views).toContain("soOrdered = ordered;");
    expect(editor).toContain("More than what is left on the sales order ({i.remainingQty} left) — saved as an extra.");
  });
});
