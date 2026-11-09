// Lot (bundle) lines on customer prints (owner decision 2026-11-09,
// supersedes the B1 "components never print" rule): a lot line prints its
// component DESCRIPTIONS one per row under the lot line, while the #,
// qty, unit and both price cells merge (rowSpan) across the block — the
// lot shows ONE qty and ONE price, and unit price equals the amount.
// Component quantities, costs and suppliers never reach the print model
// (PrintLineItem.components is string[] by design).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfessionalPrintDocument } from "@/components/docs/ProfessionalPrintDocument";
import type { ProfessionalPrintModel } from "@/lib/print/types";
import { quotePrintFixture } from "./fixtures/print-doc";

function lotDoc(): ProfessionalPrintModel {
  return {
    ...quotePrintFixture(),
    items: [
      {
        description: "ICT Equipment Bundle",
        qty: "1.00",
        unit: "lot",
        unitPrice: "500000.00",
        amount: "500000.00",
        components: ["Server unit", "Laptops", "Network switch"],
      },
      {
        description: "Laptop unit",
        qty: "1.00",
        unit: "pc",
        unitPrice: "52000.00",
        amount: "52000.00",
      },
    ],
    totals: [
      { label: "Total", amount: "552000.00", emphasize: true },
    ],
  };
}

function itemsTable(markup: string): string {
  const start = markup.indexOf('<table class="pp-items">');
  const end = markup.indexOf("</table>", start);
  expect(start).toBeGreaterThan(-1);
  return markup.slice(start, end);
}

const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("lot lines on the print", () => {
  it("lists each component on its own row under the lot line", () => {
    const table = itemsTable(renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc: lotDoc() })));
    const lotAt = table.indexOf("ICT Equipment Bundle");
    expect(lotAt).toBeGreaterThan(-1);
    for (const name of ["Server unit", "Laptops", "Network switch"]) {
      expect(table.indexOf(name)).toBeGreaterThan(lotAt);
    }
    // Component rows come before the next numbered line.
    expect(table.indexOf("Server unit")).toBeLessThan(table.indexOf("Laptop unit"));
  });

  it("merges #, qty, unit and both price cells across the lot block", () => {
    const table = itemsTable(renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc: lotDoc() })));
    // 3 components + the lot row = span 4, on exactly the 5 merged cells.
    expect(occurrences(table, 'rowSpan="4"')).toBe(5);
    // The lot price appears once as unit price and once as amount.
    expect(occurrences(table, "₱500,000.00")).toBe(2);
    // The normal line keeps its own unmerged row.
    expect(occurrences(table, "₱52,000.00")).toBe(2);
  });

  it("a line without components renders exactly one plain row", () => {
    const doc = quotePrintFixture();
    const table = itemsTable(renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc })));
    expect(table).not.toContain("rowSpan");
  });
});
