import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Quote delivery address pick (Option B, Jerwin, 2026-11-08): a quote can
// carry one of the customer's saved addresses; the server snapshots its
// text at save time (the PO pattern), the print prefers the snapshot, and
// the Convert dialog pre-selects it. Source-level guards (the editor is a
// client component); behaviour is covered by the db test.
const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const schema = read("prisma/schema.prisma");
const validation = read("src/lib/validation/quotes.ts");
const service = read("src/lib/services/quotes.ts");
const printViews = read("src/lib/print/views.ts");
const editor = read("src/components/docs/QuoteEditor.tsx");
const editorData = read("src/app/(app)/quotes/editor-data.ts");
const actions = read("src/app/(app)/quotes/actions.ts");
const recordPage = read("src/app/(app)/quotes/[id]/page.tsx");

describe("quote delivery address: data + service", () => {
  it("the Quote model carries the pick and its snapshot, Address links back", () => {
    expect(schema).toContain("deliveryAddressId   String?");
    expect(schema).toContain("deliveryAddressText String?  @db.Text");
    expect(schema).toContain("deliveryAddress     Address? @relation(fields: [deliveryAddressId], references: [id])");
    expect(schema).toContain("quotes         Quote[]");
  });

  it("an additive migration adds both columns and the FK", () => {
    const p = "prisma/migrations/20261108184000_quote_delivery_address/migration.sql";
    expect(existsSync(path.join(process.cwd(), p))).toBe(true);
    const sql = read(p);
    expect(sql).toContain("ADD COLUMN `deliveryAddressId`");
    expect(sql).toContain("ADD COLUMN `deliveryAddressText`");
    expect(sql).toContain("Quote_deliveryAddressId_fkey");
    expect(sql).not.toContain("DROP");
  });

  it("the payload schema accepts the pick and QuoteInput keeps it optional", () => {
    expect(validation).toContain("deliveryAddressId: optionalId");
    expect(validation).toContain("deliveryAddressId?: string | null");
  });

  it("the service validates ownership and snapshots via formatAddress", () => {
    expect(service).toContain("resolveDeliveryPick");
    expect(service).toContain("That delivery address doesn't belong to this customer.");
    expect(service).toContain("formatAddress(address, { multiline: true })");
    // copyQuote carries the pick + snapshot.
    expect(service).toContain("deliveryAddressId: original.deliveryAddressId");
    expect(service).toContain("deliveryAddressText: original.deliveryAddressText");
  });
});

describe("quote delivery address: print, record, editor", () => {
  it("the quote print prefers the snapshot over the live suggestion", () => {
    expect(printViews).toContain("q.deliveryAddressText?.trim() ? q.deliveryAddressText : await suggestedDeliveryAddress(q.customer)");
  });

  it("the record page shows the pick and pre-selects it for conversion", () => {
    expect(recordPage).toContain("<dt>Delivery address</dt>");
    expect(recordPage).toContain("customerAddress={q.deliveryAddressText ?? suggestedAddress}");
  });

  it("editor customers carry address options, the default delivery id, and billing text", () => {
    expect(editorData).toContain("toEditorAddressOption");
    expect(editorData).toContain("defaultDeliveryId");
    expect(editorData).toContain("billingText");
  });

  it("the editor renders the picker, sends the pick, and can add an address", () => {
    expect(editor).toContain('htmlFor="deliveryAddressId"');
    expect(editor).toContain("Customer default — decide at conversion");
    // Add-entry-points PR-1 (2026-11-08): the in-select add option became a
    // visible "Add address" button beside the picker.
    expect(editor).toContain("Add address");
    expect(editor).toContain("setAddAddressOpen(true)");
    expect(editor).not.toContain('value="__add__"');
    expect(editor).toContain("deliveryAddressId: deliveryPick || null");
    expect(editor).toContain("setDeliveryPick(c?.defaultDeliveryId ?? \"\")");
    expect(actions).toContain("createQuoteAddressAction");
    expect(actions).toContain('kind: "DELIVERY"');
  });
});
