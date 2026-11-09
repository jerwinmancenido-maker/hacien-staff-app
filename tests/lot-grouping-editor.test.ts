// Lot grouping editor wiring (2026-11-09): source pins for the Move-to-lot
// controls, the LOT n badge, the lot qty lock, and the member specs
// textarea — in BOTH editor branches (desktop + mobile render at once).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const editor = readFileSync(join(process.cwd(), "src/components/docs/QuoteEditor.tsx"), "utf8");
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
    expect(editor).toContain('qty: "1", unit: "lot"');
    expect(count("disabled={i.isLot === true}")).toBe(2); // desktop + mobile qty inputs
  });

  it("lot lines carry their LOT n badge in both branches", () => {
    expect(count('className="quote-lot-badge"')).toBe(2);
    expect(count("lotNumberOf(items, i.key)")).toBe(2);
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
