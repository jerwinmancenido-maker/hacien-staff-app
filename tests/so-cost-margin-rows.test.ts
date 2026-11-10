// SO Cost & margin tab: purchase rows navigate to the PO from anywhere on
// the row (Jerwin, 2026-11-10 — before this only the PO number was a link,
// so the row and supplier name felt dead). Same stretched-link pattern as
// the SO Documents tab (PR #186): the number stays the real anchor and the
// row carries clickable + row-has-link.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SoCostMarginTab } from "@/components/purchasing/SoCostMarginTab";
import type { CostMarginSummary } from "@/lib/purchasing/cost-margin";

const summary: CostMarginSummary = {
  rows: [
    {
      id: "po-1",
      number: "PO-2026-0001",
      status: "DRAFT",
      supplierName: "UNO Management Group",
      poTotal: "40355.00",
      receivedValue: "0.00",
      billedAmount: "0.00",
      hasBills: false,
      hasReceipts: false,
      basis: "PO_TOTAL",
      basisLabel: "PO total",
      cost: "40355.00",
      billedOverPo: false,
    },
  ],
  totalCost: "40355.00",
  contractPrice: "94130.00",
  withholdingTotal: "941.30",
  incurredCost: "0.00",
  plannedCost: "40355.00",
  costState: "partial",
  marginLabel: "Margin so far",
  actual: { margin: "0.00", marginPct: "0.00" },
  planned: { margin: "53775.00", marginPct: "57.13" },
  afterWithholding: { margin: "0.00", marginPct: "0.00", netReceived: "93188.70" },
  warnings: [],
};

describe("SoCostMarginTab purchase rows", () => {
  it("renders whole-row clickable PO rows via the stretched link", () => {
    const html = renderToStaticMarkup(createElement(SoCostMarginTab, { summary }));
    expect(html).toContain('class="clickable row-has-link"');
    expect(html).toContain('class="row-stretched-link" href="/purchase-orders/po-1"');
    expect(html).toContain("UNO Management Group");
  });
});
