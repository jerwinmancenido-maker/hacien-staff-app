// Lot grouping editor wiring (2026-11-09): source pins for the Move-to-lot
// controls, the LOT n badge, the lot qty lock, and the member specs
// textarea — in BOTH editor branches (desktop + mobile render at once).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyLotToggle, moveComponentOut, moveComponentToLot, removeLotComponent, type LotComponentShape, type LotToggleShape } from "@/lib/quotes/lot-moves";

const editor = readFileSync(join(process.cwd(), "src/components/docs/QuoteEditor.tsx"), "utf8");
const lotMoves = readFileSync(join(process.cwd(), "src/lib/quotes/lot-moves.ts"), "utf8");
const count = (needle: string) => editor.split(needle).length - 1;

describe("lot grouping editor wiring", () => {
  it("wires the pure lot-moves module for lines and components", () => {
    expect(editor).toContain('from "@/lib/quotes/lot-moves"');
    expect(editor).toContain("moveLineIntoLot(xs, line.key, lotKey)");
    expect(editor).toContain("moveComponentToLot(xs, line.key, comp.key, target)");
    expect(editor).toContain("moveComponentOut(xs, line.key, comp.key");
  });

  it("every line and every component gets a Move-to select in both branches", () => {
    // Lines: desktop actions + mobile card actions.
    expect(count("onMoveLineToLot(i, ev.target.value)")).toBe(2);
    // Components: desktop + mobile component rows, incl. "Out of lot".
    expect(count("onMoveComponent(i, c, ev.target.value)")).toBe(2);
    expect(count('<option value="__out__">Out of lot</option>')).toBe(2);
  });

  it("ticking Lot locks the line to one bundle and the qty inputs disable", () => {
    expect(editor).toContain("applyLotToggle(x, on, blankComponent)");
    expect(lotMoves).toContain('qty: "1", unit: "lot"');
    expect(count("disabled={i.isLot === true}")).toBe(2); // desktop + mobile qty inputs
  });

  it("the editor's lot total uses qty 1, matching the save planner (Bugbot PR #175)", () => {
    // safeLine's lot branch: the save side (planItems forcing qty "1") is
    // unit-tested in lot-components.test.ts; this pins the editor side.
    expect(count('qty: "1", unitPrice: i.unitPrice || "0", supplierUnitCost: "0"')).toBe(1);
  });

  it("lot lines carry their LOT n badge in both branches", () => {
    expect(count('className="quote-lot-badge"')).toBe(2);
    expect(count("lotNumberOf(items, i.key)")).toBe(2);
  });

  it("the badge renders ONLY on lot lines — no LOT 0 on normal lines (CTO fix 2026-11-09)", () => {
    // Both badge sites (desktop + mobile) are gated on the line being a
    // lot; the lot bar itself (with the Lot checkbox) stays on every
    // costs line so staff can tick it.
    expect(count('i.isLot ? <span className="quote-lot-badge"')).toBe(2);
  });

  it("the member description is a textarea (title + specs), not an input, in both branches", () => {
    // Both comp-description fields are textareas (a third rows={3} in the
    // file is the unrelated terms-remarks box).
    expect(count("id={`comp-desc-${c.key}`}")).toBe(1);
    expect(count("id={`m-comp-desc-${c.key}`}")).toBe(1);
    expect(count("<textarea")).toBeGreaterThanOrEqual(2);
    expect(editor).not.toContain('<input\n                                      id={`comp-desc-');
    expect(editor).not.toContain('<input\n                                      id={`m-comp-desc-');
    expect(count("prints as the part title")).toBe(2); // the members hint, both branches
  });
});

describe("lot toggle restore + empty-lot moves (Bugbot PR #175)", () => {
  const comp = (key: string): LotComponentShape => ({
    key, id: null, itemId: null, description: `Part ${key}`, qty: "1", unit: "pc", supplierId: null, unitCost: "10",
  });
  const line = (over: Partial<LotToggleShape> = {}): LotToggleShape => ({
    key: "l1", itemId: null, description: "Line", qty: "4", unit: "pc", supplierId: null, supplierUnitCost: "5", ...over,
  });
  const blank = () => comp("blank-1");

  it("ticking Lot forces one bundle and stashes the line's qty/unit", () => {
    const on = applyLotToggle(line(), true, blank);
    expect(on.isLot).toBe(true);
    expect(on.qty).toBe("1");
    expect(on.unit).toBe("lot");
    expect(on.preLotQty).toBe("4");
    expect(on.preLotUnit).toBe("pc");
    expect(on.components).toHaveLength(1); // a fresh lot starts with one blank part
  });

  it("ticking Lot keeps an existing component list", () => {
    const on = applyLotToggle(line({ components: [comp("a"), comp("b")] }), true, blank);
    expect(on.components?.map((c) => c.key)).toEqual(["a", "b"]);
  });

  it("unticking restores the stashed qty/unit — a misclick costs nothing", () => {
    const off = applyLotToggle(applyLotToggle(line(), true, blank), false, blank);
    expect(off.isLot).toBe(false);
    expect(off.qty).toBe("4");
    expect(off.unit).toBe("pc");
    expect(off.preLotQty).toBeUndefined();
    expect(off.preLotUnit).toBeUndefined();
  });

  it("unticking a lot loaded from storage (no stash) keeps its qty/unit", () => {
    const off = applyLotToggle(line({ isLot: true, qty: "1", unit: "lot", components: [comp("a")] }), false, blank);
    expect(off.isLot).toBe(false);
    expect(off.qty).toBe("1");
    expect(off.unit).toBe("lot");
  });

  it("moving a lot's LAST component to another lot un-lots the source", () => {
    const a = line({ key: "A", isLot: true, qty: "1", unit: "lot", components: [comp("c1")] });
    const b = line({ key: "B", isLot: true, qty: "1", unit: "lot", components: [comp("c9")] });
    const out = moveComponentToLot([a, b], "A", "c1", "B");
    expect(out[0]!.isLot).toBe(false);
    expect(out[0]!.components).toHaveLength(0);
    expect(out[1]!.components?.map((c) => c.key)).toEqual(["c9", "c1"]);
  });

  it("moving one of two components keeps the source a lot", () => {
    const a = line({ key: "A", isLot: true, qty: "1", unit: "lot", components: [comp("c1"), comp("c2")] });
    const b = line({ key: "B", isLot: true, qty: "1", unit: "lot", components: [] });
    const out = moveComponentToLot([a, b], "A", "c1", "B");
    expect(out[0]!.isLot).toBe(true);
    expect(out[0]!.components?.map((c) => c.key)).toEqual(["c2"]);
  });

  it("DELETING a lot's last component un-lots the line too (Bugbot re-run, PR #176)", () => {
    const a = line({ key: "A", isLot: true, qty: "1", unit: "lot", components: [comp("c1")] });
    const out = removeLotComponent([a], "A", "c1");
    expect(out[0]!.isLot).toBe(false);
    expect(out[0]!.components).toHaveLength(0);
    expect(editor).toContain("removeLotComponent(xs, lineKey, compKey)");
  });

  it("deleting one of two components keeps the lot", () => {
    const a = line({ key: "A", isLot: true, qty: "1", unit: "lot", components: [comp("c1"), comp("c2")] });
    const out = removeLotComponent([a], "A", "c1");
    expect(out[0]!.isLot).toBe(true);
    expect(out[0]!.components?.map((c) => c.key)).toEqual(["c2"]);
  });

  it("moving a lot's last component OUT un-lots the lot line", () => {
    const a = line({ key: "A", isLot: true, qty: "1", unit: "lot", components: [comp("c1")] });
    const out = moveComponentOut([a], "A", "c1", (c) => line({ key: "new-1", description: c.description }));
    expect(out[0]!.isLot).toBe(false);
    expect(out[0]!.components).toHaveLength(0);
    expect(out[1]!.key).toBe("new-1");
  });
});
