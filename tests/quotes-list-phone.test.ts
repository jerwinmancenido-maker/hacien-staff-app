import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// REQ-STAFF-390-001: the Quotes list TOTAL must stay intact at phone width.
// The 640px list min-width was scrolling through the right-aligned amount.

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("quotes list at 390px", () => {
  it("marks the total column so phone CSS can keep the amount on one line", () => {
    const src = read("src/app/(app)/quotes/page.tsx");
    expect(src).toContain('className="quotes-list"');
    expect(src).toContain('className: "qcol-total"');
    expect(src).toContain("formatPeso(q.contractPrice)");
  });

  it("stacks the quotes list under 640px and does not wrap the total", () => {
    const css = read("src/app/globals.css");
    const phone = css.slice(css.indexOf("/* Quotes list at phone width."));
    expect(phone).toContain(".quotes-list table.list {\n    min-width: 0;");
    expect(phone).toContain(".quotes-list td.qcol-total {");
    expect(phone).toMatch(/\.quotes-list td\.qcol-total \{[^}]*white-space: nowrap;/);
    expect(phone).toMatch(/\.quotes-list td\.qcol-total \{[^}]*min-width: max-content;/);
    expect(phone).not.toMatch(/\.quotes-list table\.list \{[^}]*min-width:\s*640px/);
  });
});
