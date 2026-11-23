// List no-wrap protection (final-check finding F6, generalised by the
// class-first table treatment for findings 1026/1045): document numbers,
// dates, money and short status/code cells must not wrap mid-value at ANY
// width. The protection now lives in ONE unified globals.css rule keyed by
// the .num class + data-col keys (it replaced the desktop-only media block
// and the per-table patches for the aging / SO-list / billing-list
// tables); the hand-rolled tables tag their cells with the same keys.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const billingsPage = readFileSync(new URL("../src/app/(app)/billing/billings/page.tsx", import.meta.url), "utf8");

describe("list nowrap protection (F6)", () => {
  it("the unified rule protects td.num and every listed data-col key at all widths", () => {
    const start = css.indexOf("table.list td.num,");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf("}", start));
    expect(block).toContain("white-space: nowrap");
    for (const key of [
      "number", "date", "valid", "status", "when", "who", "method", "action",
      "so", "po", "expected", "sku", "price", "total", "margin", "rev", "atc",
    ]) {
      expect(block).toContain(`td[data-col="${key}"]`);
    }
    // The old desktop-only patch shape stays retired: no min-width media
    // block governing the list data-col rules, and no per-table selectors.
    expect(css).not.toMatch(/@media \(min-width: 769px\) \{\s*table\.list td\[data-col/);
    expect(css).not.toContain("aging-table td[data-col");
    expect(css).not.toContain("billing-list-table td[data-col");
    expect(css).not.toContain("so-list-table table.list td[data-col");
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
