// Print compactness (owner-approved 2026-11-10, all prints): the shared
// .pp-items table carries tighter rows — body cell vertical padding 5px,
// header band 7px, part spec line-height 1.3. Source pins on globals.css,
// the same style as the other print CSS pins.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");

describe("print compactness", () => {
  it("body cells use 5px vertical padding", () => {
    expect(css).toContain(".pp-items th,\n.pp-items td {\n  padding: calc(5px * var(--ui-scale, 1)) calc(10px * var(--ui-scale, 1));");
  });
  it("the header band uses 7px vertical padding", () => {
    expect(css).toContain("background: var(--pp-navy);\n  font-weight: 600;\n  color: #fff;\n  padding: calc(7px * var(--ui-scale, 1)) calc(10px * var(--ui-scale, 1));");
  });
  it("part specs use line-height 1.3", () => {
    const spec = css.slice(css.indexOf(".pp-part-spec {"), css.indexOf(".pp-part-spec {") + 220);
    expect(spec).toContain("line-height: 1.3;");
  });
});
