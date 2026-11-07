import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Stacking guard (page review, Nov 2026): the row-actions "⋯" menu and the
 * sticky table header must paint above clickable-row contents.
 *
 * Root cause was a z-index tie: clickable-row children are
 * `position: relative; z-index: 1`, which beat the menu wrapper's own
 * `z-index: 2` on specificity, and tied the sticky `th` (z-index 1) so
 * later-in-DOM rows painted over the header while scrolling.
 */
describe("row menu and sticky header stacking", () => {
  const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

  it("keeps the row-menu wrapper out of the clickable-row z-index 1 rule", () => {
    expect(css).toMatch(/\.row-has-link td > \*:not\(\.row-stretched-link\):not\(\[data-no-row-click\]\)/);
    expect(css).toMatch(/\.record-card-row\.clickable > \*:not\(\.row-stretched-link\):not\(\[data-no-row-click\]\)/);
    expect(css).toMatch(/\.record-compact-row\.clickable > \*:not\(\.row-stretched-link\):not\(\[data-no-row-click\]\)/);
    expect(css).toMatch(/\.record-tile-card\.clickable > \*:not\(\.row-stretched-link\):not\(\[data-no-row-click\]\)/);
    expect(css).toMatch(/\[data-no-row-click\]\s*\{[^}]*z-index:\s*2/);
  });

  it("raises the sticky table header above scrolling row contents", () => {
    expect(css).toMatch(/table\.list th\s*\{[^}]*position:\s*sticky[^}]*z-index:\s*2/);
  });
});
