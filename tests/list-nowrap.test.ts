// List no-wrap protection (final-check finding F6): document numbers, dates
// and short status cells must not wrap mid-value on desktop widths. The
// protection lives in one globals.css media block keyed by data-col; the
// hand-rolled billings table tags its cells with the same keys.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const billingsPage = readFileSync(new URL("../src/app/(app)/billing/billings/page.tsx", import.meta.url), "utf8");

describe("list nowrap protection (F6)", () => {
  it("the desktop media block protects every listed data-col key", () => {
    const start = css.indexOf('td[data-col="number"]');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(css.lastIndexOf("@media (min-width: 769px)", start), css.indexOf("}", start));
    for (const key of ["number", "date", "valid", "status", "when", "who", "method", "action"]) {
      expect(block).toContain(`td[data-col="${key}"]`);
    }
    expect(block).toContain("white-space: nowrap");
  });

  it("the audit record column wraps its label but not its type line (F16)", () => {
    // F6's blanket nowrap on the whole record cell pushed "What happened"
    // off screen whenever a record label was long (Mac Block 1 item 5).
    // Only the short type line stays nowrap now; the label wraps.
    expect(css).toContain('table.list td[data-col="record"] > div:first-child');
    expect(css).toMatch(/table\.list td\[data-col="record"\] > div \+ div \{\s*overflow-wrap: break-word;/);
  });

  it("the sidebar milestone title never wraps", () => {
    expect(css).toMatch(/\.tracker-head > span \{\s*white-space: nowrap;/);
  });

  it("the billings table tags its number and date cells", () => {
    expect(billingsPage).toContain('data-col="number"');
    expect(billingsPage).toContain('data-col="date"');
  });
});
