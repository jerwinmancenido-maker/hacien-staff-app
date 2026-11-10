// Owner asks 2026-11-10: (1) the SO Documents tab rows should be clickable
// like the other list tables; (2) the PO editor's items table squeezed the
// description into a 1-row box — fixed column widths + an auto-growing
// description textarea. Source pins (the repo's pattern for page wiring).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(path.resolve(__dirname, "..", rel), "utf8");

describe("SO Documents tab — whole-row clickable", () => {
  const page = read("src/app/(app)/sales-orders/[id]/page.tsx");
  it("every document row uses the stretched-link pattern and the Open column is gone", () => {
    expect(page).not.toContain("<th>Link</th>");
    expect(page).not.toContain(">Open</Link>");
    const stretched = page.match(/row-stretched-link/g) ?? [];
    // quote, billing, collection, delivery, purchase order
    expect(stretched.length).toBe(5);
    const clickable = page.match(/clickable row-has-link/g) ?? [];
    expect(clickable.length).toBe(5);
    // The billing Print link survives (it sits above the stretched link).
    expect(page).toContain("/print/billings/");
    expect(page).toContain("Print");
  });
  it("delivery rows reach the delivery, not the SO Overview (FIX-002)", () => {
    // Bugbot Medium 5838939209: the DR row's only link pointed at the SO
    // page base, so the receipt itself was unreachable from Documents.
    expect(page).not.toContain("href={base} className=\"row-stretched-link\"");
    expect(page).toContain("href={`${base}?tab=deliveries`} className=\"row-stretched-link\"");
    expect(page).toContain("/print/deliveries/");
    expect(page).toContain("/attachment");
  });
});

describe("PO editor items table layout", () => {
  const editor = read("src/components/purchasing/PoEditor.tsx");
  const css = read("src/app/globals.css");
  it("uses the PO-scoped fixed layout with named column classes", () => {
    expect(editor).toContain("po-items-edit");
    expect(editor).toContain("col-kind");
    expect(editor).toContain("col-qty");
    expect(editor).toContain("col-unit");
    expect(editor).toContain("col-money");
    expect(css).toContain(".edit-table.items-edit.po-items-edit table.list");
    expect(css).toContain("table-layout: fixed");
  });
  it("the description textarea auto-grows like the quote editor's", () => {
    expect(editor).toContain("PoDescTextarea");
    expect(editor).toContain("scrollHeight");
    expect(editor).toContain('className="po-desc"');
    expect(css).toContain("textarea.po-desc");
    expect(css).toContain("field-sizing: content");
  });
});
