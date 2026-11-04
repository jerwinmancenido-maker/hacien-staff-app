import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// S-66: record pages keep every action in the one Actions menu — no
// separate blue main button beside it (e.g. Convert to SO on quotes,
// Edit order on sales orders).

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("S-66 record pages: actions live in the menu, not beside it", () => {
  it("quote actions have no standalone blue button; workflow actions are menu items", () => {
    const src = read("src/components/docs/QuoteActions.tsx");
    expect(src).not.toContain('className="btn"');
    expect(src).toContain('key: "approve", label: "Approve"');
    expect(src).toContain('key: "reject", label: "Reject"');
    expect(src).toContain('key: "mark-sent", label: "Mark as sent"');
    expect(src).toContain('key: "open-so", label: "Open sales order"');
    // Convert to SO was already a menu item — its duplicate button is gone.
    expect(src).toContain('key: "convert", label: "Convert to SO"');
  });

  it("PO actions have no standalone blue button; Mark as sent / Approve PO are menu items", () => {
    const src = read("src/components/purchasing/PoActions.tsx");
    expect(src).not.toContain('className="btn"');
    expect(src).toContain('key: "mark-sent", label: "Mark as sent"');
    expect(src).toContain('key: "approve", label: "Approve PO"');
    // Receive items and Close PO were already menu items.
    expect(src).toContain('key: "receive", label: "Receive items"');
    expect(src).toContain('key: "close"');
  });

  it("SO actions have no Edit order button; Record billing and Create POs are menu items", () => {
    const src = read("src/components/docs/QuoteActions.tsx");
    expect(src).not.toContain("Edit order");
    expect(src).toContain('key: "record-billing", label: "Record billing"');
    expect(src).toContain('key: "create-pos", label: "Create POs"');
    expect(src).toContain('key: "edit", label: "Edit"');
  });

  it("SO page passes billing/PO gates into the menu and renders no standalone buttons", () => {
    const src = read("src/app/(app)/sales-orders/[id]/page.tsx");
    expect(src).toContain("canBill={canBill} canCreatePos={canCreatePos}");
    // The billing / PO links themselves now live only in the menu
    // (QuoteActions.tsx); the page no longer renders them as buttons.
    expect(src).not.toContain("billings/new?salesOrderId=");
    expect(src).not.toContain("sales-orders/${so.id}/purchase-orders");
  });

  it("PO page has no card-head shortcut buttons duplicating the menu", () => {
    const src = read("src/app/(app)/purchase-orders/[id]/page.tsx");
    expect(src).not.toContain('className="btn btn-sm"');
  });
});
