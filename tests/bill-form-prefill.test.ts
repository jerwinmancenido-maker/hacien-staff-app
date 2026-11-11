// Supplier bill form: billed lines start prefilled from the PO (Jerwin,
// 2026-11-11: "can it be prefilled with the PO, then can just change").
// The prefilled values are starting points only — every line stays
// editable, the "Fill from received qty" button keeps its meaning, and
// the server's per-line cap (billed qty <= received, not yet billed) is
// unchanged, so a prefilled save on an unreceived PO is refused with the
// received-cap message naming the line.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BillForm, type BillLine } from "@/components/purchasing/BillForm";

const lines: BillLine[] = [
  { id: "li-1", description: "Copper Tube\nOD 3/8", unit: "Roll", qty: "1.00", unitCost: "3255.00", receivedQty: "0.00" },
  { id: "li-2", description: "Silver Rod", unit: "Pcs", qty: "100.00", unitCost: "17.00", receivedQty: "40.00" },
];

async function noopAction(): Promise<never> {
  throw new Error("not called in render tests");
}

function render() {
  return renderToStaticMarkup(
    createElement(BillForm, {
      lines,
      defaultDate: "2026-11-11",
      action: noopAction as never,
      cancelHref: "/purchase-orders/po-1",
      maxMb: 10,
    }),
  );
}

describe("BillForm PO prefill", () => {
  it("billed qty inputs start at the PO qty and prices at the PO unit cost", () => {
    const html = render();
    expect(html).toContain('value="1"'); // Copper Tube qty (trailing .00 trimmed)
    expect(html).toContain('value="100"'); // Silver Rod qty
    expect(html).toContain('value="3255.00"'); // Copper Tube price (raw until edited; formatMoneyInput applies on change)
    expect(html).toContain('value="17.00"');
  });

  it("the payload carries the prefilled lines, so an untouched save bills the full PO", () => {
    const html = render();
    const m = html.match(/name="payload" value="([^"]*)"/);
    expect(m).not.toBeNull();
    const payload = JSON.parse(
      m![1]!.replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
    ) as { lines: { purchaseOrderItemId: string; qty: string; unitPrice: string }[] };
    expect(payload.lines).toEqual([
      { purchaseOrderItemId: "li-1", qty: "1", unitPrice: "3255.00" },
      { purchaseOrderItemId: "li-2", qty: "100", unitPrice: "17.00" },
    ]);
  });

  it("the hint says the lines are prefilled and how to drop one", () => {
    const html = render();
    expect(html).toContain("Prefilled from the PO");
  });

  it("Fill from received qty is still offered", () => {
    expect(render()).toContain("Fill from received qty");
  });
});
