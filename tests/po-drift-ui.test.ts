// Same-rate drift warning (ERP adoption item 6) — source pins for the PO
// editor's inline warning and the save action's warn-never-block gate.
// Behaviour of the helpers is covered in tests/po-drift.test.ts; the server
// loader in tests/db/po-drift.db.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const editor = readFileSync("src/components/purchasing/PoEditor.tsx", "utf8");
const actions = readFileSync("src/app/(app)/purchase-orders/actions.ts", "utf8");
const drift = readFileSync("src/lib/purchasing/drift.ts", "utf8");

describe("PO editor — inline drift warning", () => {
  it("computes drift per linked line from the loaded SO cost", () => {
    expect(editor).toContain("costDrift(i.unitCost, i.soUnitCost)");
    expect(editor).toContain("i.linked && i.soUnitCost != null");
  });

  it("renders the warning in warn styling with both prices via the shared text", () => {
    expect(editor).toContain("Cost differs from the sales order —");
    expect(editor).toContain("driftDetailText(");
    expect(editor).toContain('className="small warn-text"');
  });

  it("keeps the Changed vs sales order marker as-is (Part B / REQ-192)", () => {
    expect(editor).toContain("Changed vs sales order — SO:");
    expect(editor).toContain("changedVsSo(i)");
  });
});

describe("PO editor — save-time soft warning (PR #360 pattern)", () => {
  it("shows the server warning with a Save anyway confirm path", () => {
    expect(editor).toContain("state.warning");
    expect(editor).toContain('name="confirmDriftWarning"');
    expect(editor).toContain("Save anyway");
    // Only the Save anyway button sets the flag; plain Save re-warns.
    expect(editor).toContain('confirmDriftRef.current.value = "1"');
  });
});

describe("PO save action — warn, never block", () => {
  it("checks drift after validation and before saving, unless confirmed", () => {
    expect(actions).toContain('str(form, "confirmDriftWarning") !== "1"');
    expect(actions).toContain("findPoCostDrift(db, id, parsed.data.items)");
    expect(actions).toContain("return { warning: driftWarningMessage(drift) }");
    expect(actions.indexOf("findPoCostDrift")).toBeLessThan(actions.indexOf("updatePurchaseOrder(id, parsed.data, user)"));
  });

  it("the gate lives only on the editor save — Create POs keeps SO costs verbatim", () => {
    const createBlock = actions.slice(actions.indexOf("createPosFromSalesOrderAction"), actions.indexOf("savePurchaseOrderAction"));
    expect(createBlock).not.toContain("findPoCostDrift");
    expect(createBlock).toContain("createPurchaseOrdersFromSalesOrder");
  });
});

describe("drift module — the rule is stated in code", () => {
  it("documents warn-never-block and the standalone no-link rule", () => {
    expect(drift).toContain("warn, NEVER");
    expect(drift).toContain("no\n//   upstream agreed price");
    expect(drift).toContain("PRICE_DIFFERS");
  });
});
