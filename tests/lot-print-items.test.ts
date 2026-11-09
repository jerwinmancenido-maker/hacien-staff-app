// Lot (bundle) lines on customer prints — BLOCK design (owner 2026-11-09,
// supersedes the #160 itemized-rows layout and the B1 "components never
// print" rule): a lot prints NO title row (its name rides on the Subject);
// each member is one bordered part row — bold title, spec bullets, its OWN
// qty/unit — while the #, Unit Price and Amount cells merge (rowSpan)
// across the block. The lot's qty is always 1, so Unit Price and Amount
// are the same figure (arithmetic, not duplication). Costs and suppliers
// never reach the print model (PrintLotPart has no such fields by design).
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
        description: "PBRIS ICT Software Subscription",
        qty: "1.00",
        unit: "lot",
        unitPrice: "598000.00",
        amount: "598000.00",
        components: [
          {
            title: "Google Cloud Platform Services",
            specs: ["One (1) year subscription under a fixed annual budget ceiling", "Firebase Blaze Plan"],
            qty: "1.00",
            unit: "lot",
          },
          {
            title: "Anthropic Claude Max 5x Plan",
            specs: ["One (1) year subscription"],
            qty: "2.00",
            unit: "Licenses",
          },
        ],
      },
      {
        description: "Support hours — remote, per hour",
        qty: "10.00",
        unit: "hour",
        unitPrice: "1500.00",
        amount: "15000.00",
      },
    ],
    totals: [{ label: "Total", amount: "613000.00", emphasize: true }],
  };
}

function itemsTable(markup: string): string {
  const start = markup.indexOf('<table class="pp-items');
  const end = markup.indexOf("</table>", start);
  expect(start).toBeGreaterThan(-1);
  return markup.slice(start, end);
}

const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("lot lines on the print (block design)", () => {
  it("prints each member as a part block with title, specs and its own qty/unit — and NO lot title row", () => {
    const table = itemsTable(renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc: lotDoc() })));
    // The lot's own name never prints in the table (Subject carries it).
    expect(table).not.toContain("PBRIS ICT Software Subscription");
    // Parts print in order, before the next numbered line.
    const gcp = table.indexOf("Google Cloud Platform Services");
    const claude = table.indexOf("Anthropic Claude Max 5x Plan");
    const normal = table.indexOf("Support hours");
    expect(gcp).toBeGreaterThan(-1);
    expect(claude).toBeGreaterThan(gcp);
    expect(normal).toBeGreaterThan(claude);
    // Specs print as bullets under their part's title.
    expect(table).toContain("• One (1) year subscription under a fixed annual budget ceiling");
    expect(table).toContain("• Firebase Blaze Plan");
    // Each part shows its OWN qty and unit.
    expect(table).toContain("Licenses");
    expect(occurrences(table, "pp-part-title")).toBe(2);
  });

  it("merges #, Unit Price and Amount across the block; qty/unit stay per-part", () => {
    const table = itemsTable(renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc: lotDoc() })));
    // 2 parts = span 2, on exactly the 3 merged cells (#, unit price, amount).
    expect(occurrences(table, 'rowSpan="2"')).toBe(3);
    // The lot price appears once as unit price and once as amount.
    expect(occurrences(table, "₱598,000.00")).toBe(2);
    // The normal line keeps its own unmerged price pair.
    expect(occurrences(table, "₱15,000.00")).toBe(1);
    expect(occurrences(table, "₱1,500.00")).toBe(1);
  });

  it("borders the items grid on quote/SO prints only (audit D3 scope)", () => {
    const quote = renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc: lotDoc() }));
    expect(quote).toContain("pp-items pp-items-bordered");
    const poDoc = { ...lotDoc(), kind: "supplier_po" as const };
    const po = renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc: poDoc }));
    expect(po).not.toContain("pp-items-bordered");
  });

  it("a line without components renders exactly one plain row", () => {
    const doc = quotePrintFixture();
    const table = itemsTable(renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc })));
    expect(table).not.toContain("rowSpan");
  });
});

describe("SO lot prints name the lot (CTO fix 2026-11-09)", () => {
  it("an SO lot block leads with the lot's own description row", () => {
    // SO print models never set a subject, so without this row the lot
    // printed with no name at all — only anonymous member parts.
    const soDoc = { ...lotDoc(), kind: "sales_order" as const };
    const table = itemsTable(renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc: soDoc })));
    expect(table).toContain("pp-lot-name");
    // The lot's name prints exactly once, ahead of its member parts.
    expect(occurrences(table, "PBRIS ICT Software Subscription")).toBe(1);
    expect(table.indexOf("PBRIS ICT Software Subscription")).toBeLessThan(table.indexOf("Google Cloud Platform Services"));
    // Name row + 2 parts = span 3 on exactly the 3 merged cells.
    expect(occurrences(table, 'rowSpan="3"')).toBe(3);
    // The lot's price pair still prints once each, on the merged cells.
    expect(occurrences(table, "₱598,000.00")).toBe(2);
    // Parts keep their own qty/unit under the named block.
    expect(table).toContain("Licenses");
    expect(occurrences(table, "pp-part-title")).toBe(2);
  });

  it("a quote lot block still prints NO lot name row (owner design)", () => {
    const table = itemsTable(renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc: lotDoc() })));
    expect(table).not.toContain("pp-lot-name");
    expect(table).not.toContain("PBRIS ICT Software Subscription");
  });
});
