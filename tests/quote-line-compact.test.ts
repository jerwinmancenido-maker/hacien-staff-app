import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Compact lines Phase 1 (Jerwin, 2026-11-08): one search box per line —
// typing opens a two-line dropdown (name + price, then SKU · brand ·
// model · unit), an exact SKU ranks first (barcode scanners), kind /
// withholding / cost collapse behind a per-line "More" toggle, and the
// keyboard flow picks with ↑/↓ + Enter and jumps line to line from the
// price field. Source-level guards (the editor is a client component).
const editor = readFileSync(path.join(process.cwd(), "src/components/docs/QuoteEditor.tsx"), "utf8");
const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
const search = readFileSync(path.join(process.cwd(), "src/lib/items/search.ts"), "utf8");

describe("compact quote line: search box and dropdown", () => {
  it("the description box carries the search placeholder", () => {
    expect(editor).toContain('placeholder="Search by product name or SKU…"');
    expect(editor).toContain("<span>Product — search by name or SKU</span>");
  });

  it("results render on two lines with a labelled SKU", () => {
    expect(editor).toContain("quote-picker-name");
    expect(editor).toContain("quote-picker-meta");
    expect(editor).toContain("SKU <b>{r.sku}</b>");
    expect(editor).toContain("quote-picker-opt");
    expect(css).toContain(".quote-picker-opt.is-active");
  });

  it("an exact SKU match ranks first and category is searchable", () => {
    expect(search).toContain("sku: { equals: q }");
    expect(search).toContain("{ category: { contains: q } }");
    expect(search).toContain("notIn: exactSku.map");
    expect(search).toContain("[...exactSku, ...rest]");
  });
});

describe("compact quote line: collapsed details behind More", () => {
  it("both layouts have the More toggle and section", () => {
    expect(editor.match(/aria-label=\{`Line \$\{idx \+ 1\} details`\}/g)?.length).toBe(2);
    expect(editor.match(/aria-expanded=\{expanded\}/g)?.length).toBe(2);
    expect(editor.match(/className="quote-ln-more"/g)?.length).toBe(2);
    expect(css).toContain(".quote-ln-more");
  });

  it("override and error lines start expanded", () => {
    expect(editor.match(/expandedLines\[i\.key\] \?\? \(showOverride \|\| !!whPctErrors\[i\.key\]\)/g)?.length).toBe(2);
  });

  it("the collapsed row shows a kind + WHT chip and a margin badge", () => {
    expect(editor).toContain("· {whLabel}");
    expect(editor.match(/quote-tg-cost/g)?.length).toBeGreaterThanOrEqual(4);
    expect(editor).toContain("Margin {marginPct}%");
    expect(editor).toContain("Below cost");
    expect(editor).toContain("Cost not set");
  });

  it("the old always-visible cost strip is gone", () => {
    expect(editor).not.toContain("quote-cost");
    expect(css).not.toContain(".quote-cost");
    expect(editor).not.toContain("Cost (internal)");
  });
});

describe("compact quote line: keyboard flow", () => {
  it("the description handles arrows, Enter and Escape for the picker", () => {
    expect(editor).toContain("function onDescKeyDown");
    expect(editor).toContain('ev.key === "ArrowDown"');
    expect(editor).toContain('ev.key === "ArrowUp"');
    expect(editor).toContain('ev.key === "Escape"');
    expect(editor.match(/onKeyDown=\{\(ev\) => onDescKeyDown\(i, ev\)\}/g)?.length).toBe(2);
  });

  it("Enter on a price field moves to the next line's search box", () => {
    expect(editor).toContain("function onPriceKeyDown");
    expect(editor).toContain("function focusLineDesc");
    expect(editor.match(/onKeyDown=\{\(ev\) => onPriceKeyDown\(idx, ev\)\}/g)?.length).toBe(2);
  });
});
