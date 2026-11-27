// Disposition PR 3 (Group D) — findings 1024 + 1029, polish-only fixes.
//
// 1024: the 1701Q screen stacked three notice blocks before the worksheet
// (the worksheet banner, the basis alert, the line-(a) prose paragraph).
// They are now ONE consolidated block holding the same governed strings
// verbatim, in the same order — the wording is MOVED, never reworded
// (BIR-WORDING guardrail) — and the DualLine labels get a balanced wrap so
// line (f)'s long label no longer strands "EWT)" on its own line.
// 1029: ItemsTable (quote + SO detail screens only; prints use their own
// components) caps long descriptions visually (3-line clamp) with the full
// text preserved in the DOM and in a title attribute, and the two money
// headers that wrapped (Supplier total, {shortName} price) go no-wrap.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  INCOME_TAX_LINE_HINTS,
  TAX_BASIS_UNVERIFIED_NOTE,
  TAX_WORKSHEET_BANNER,
} from "@/lib/tax/constants";

const incomePage = readFileSync("src/app/(app)/books/tax/income/page.tsx", "utf8");
const docParts = readFileSync("src/components/docs/DocParts.tsx", "utf8");
const css = readFileSync("src/app/globals.css", "utf8");

const count = (hay: string, needle: string) => hay.split(needle).length - 1;

describe("1024 — 1701Q consolidated pre-table block", () => {
  it("the governed strings are the verbatim governed wording (pins — a reword fails here)", () => {
    expect(TAX_WORKSHEET_BANNER).toBe(
      "Worksheet only — check with your accountant before filing. Not filed by this app.",
    );
    expect(TAX_BASIS_UNVERIFIED_NOTE).toBe(
      "Invoiced is the main basis (EOPT, RR 3-2024). Collected is shown as a reference only.",
    );
    expect(INCOME_TAX_LINE_HINTS.a).toBe(
      "Two figures from January to the end of the quarter — shown side by side, not combined.",
    );
  });

  it("renders ONE block: banner, basis note, line-(a) hint, line-(a) prose — each exactly once, in order", () => {
    const markers = [
      "{TAX_WORKSHEET_BANNER}",
      "{TAX_BASIS_UNVERIFIED_NOTE}",
      "{INCOME_TAX_LINE_HINTS.a} The 8% math is unchanged; Collected is kept only as a reference",
      "Invoiced basis (line a): gross billings {formatPeso(sheet.invoicedGrossTotal)}, less customer returns",
      "period they were posted; the collected column is not reduced by returns.",
    ];
    let last = -1;
    for (const m of markers) {
      expect(count(incomePage, m)).toBe(1);
      const idx = incomePage.indexOf(m);
      expect(idx).toBeGreaterThan(last);
      last = idx;
    }
    // The old standalone pieces are gone: no banner component render, no
    // separate prose paragraph; the one warn alert is the consolidated block.
    expect(incomePage).not.toContain("<TaxWorksheetBanner");
    expect(incomePage).not.toContain('<p className="small" style={{ marginBottom: 12 }}>');
    expect(count(incomePage, 'className="alert warn"')).toBe(1);
  });

  it("the line-(a) prose keeps its three figures from the worksheet (no figure change)", () => {
    expect(incomePage).toContain("{formatPeso(sheet.invoicedGrossTotal)}");
    expect(incomePage).toContain("{formatPeso(sheet.invoicedReturnsTotal)}");
    expect(incomePage).toContain("net {formatPeso(sheet.invoicedTotal)}");
  });

  it("line (f)'s label is verbatim and the label cell carries the balanced-wrap class", () => {
    expect(incomePage).toContain(
      "label=\"Less creditable withholding (customers' 2307s / collections EWT)\"",
    );
    expect(incomePage).toContain('<div className="line-label">{label}</div>');
    expect(css).toContain(".tax-income-worksheet .line-label");
    expect(css).toContain("text-wrap: balance");
  });

  it("worksheet rows a–g keep their order", () => {
    let last = -1;
    for (const letter of ["a", "b", "c", "d", "e", "f", "g"]) {
      const idx = incomePage.indexOf(`letter="${letter}"`);
      expect(idx).toBeGreaterThan(last);
      last = idx;
    }
  });
});

describe("1029 — ItemsTable visual cap", () => {
  it("the description renders in full, with the cap class and the full text in a title", () => {
    expect(docParts).toContain('className="strong items-desc" title={i.description}');
    expect(docParts).toContain("{i.description}");
    expect(css).toContain(".items-table .items-desc");
    expect(css).toContain("-webkit-line-clamp: 3");
  });

  it("the two money headers that wrapped are no-wrap", () => {
    expect(docParts).toContain(
      '<th className="num" style={{ whiteSpace: "nowrap" }}>Supplier total</th>',
    );
    expect(docParts).toContain(
      '<th className="num" style={{ whiteSpace: "nowrap" }}>{shortName} price</th>',
    );
  });

  it("ItemsTable serves exactly the two screen pages; print pages use none of DocParts", () => {
    expect(readFileSync("src/app/(app)/quotes/[id]/page.tsx", "utf8")).toContain("ItemsTable");
    expect(readFileSync("src/app/(app)/sales-orders/[id]/page.tsx", "utf8")).toContain(
      "ItemsTable",
    );
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
      );
    const printFiles = walk("src/app/print").filter((f) => f.endsWith(".tsx"));
    expect(printFiles.length).toBeGreaterThan(0);
    for (const f of printFiles) {
      expect(readFileSync(f, "utf8")).not.toContain("DocParts");
    }
    // The print 1701Q page keeps its own basis-note render (checked neighbour).
    expect(readFileSync("src/app/print/books/tax/income/page.tsx", "utf8")).toContain(
      "{TAX_BASIS_UNVERIFIED_NOTE}",
    );
  });
});
