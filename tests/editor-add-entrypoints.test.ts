import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Add-entry-points (2026-11-08) + add-in-dropdown pickers (2026-11-09):
// a create action must never hide as an OPTION inside a dropdown — in a
// native <select> popup the top rows scroll out of sight once a record is
// picked, so staff could not add a customer from the quote editor. The
// 2026-11-08 sweep moved the adds to visible buttons beside the fields.
// The owner reversed that placement on 2026-11-09 ("can these buttons only
// appear inside the drop box, like Add customer in the product box"):
// record fields in the quote and PO editors are now SearchPickers — a
// custom panel under the field whose list scrolls INSIDE the panel while
// the "+ Add …" row stays pinned below the scroll area, so it can never
// scroll out of sight the way the native-popup option did. The SO editor
// (DocumentEditor) keeps its beside-field button — it was outside the
// owner's 2026-11-09 scope. The inline dialogs and actions are unchanged.
const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const quoteEditor = read("src/components/docs/QuoteEditor.tsx");
const docEditor = read("src/components/docs/DocumentEditor.tsx");
const poEditor = read("src/components/purchasing/PoEditor.tsx");
const searchPicker = read("src/components/SearchPicker.tsx");
const globalsCss = read("src/app/globals.css");
const contactDialog = read("src/components/docs/AddContactDialog.tsx");
const contactActions = read("src/app/(app)/contacts/actions.ts");
const supplierDialog = read("src/components/purchasing/AddSupplierDialog.tsx");
const supplierActions = read("src/app/(app)/suppliers/actions.ts");

function srcFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? srcFiles(p) : [p];
  });
}

describe("no create action hides inside a select, anywhere in src", () => {
  it("no file uses a __add__ select option", () => {
    const offenders = srcFiles(path.join(process.cwd(), "src"))
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => readFileSync(f, "utf8").includes('value="__add__"'));
    expect(offenders).toEqual([]);
  });
});

describe("the SearchPicker pins its add row below the scrolling list", () => {
  it("the option list scrolls inside the panel; the add row renders after it", () => {
    expect(searchPicker).toContain("search-picker-list");
    expect(searchPicker.indexOf("search-picker-list")).toBeLessThan(searchPicker.indexOf("quote-picker-add"));
    expect(globalsCss).toContain(".search-picker-list");
    expect(globalsCss).toContain("overflow-y: auto");
  });
});

describe("quote editor entry points", () => {
  it("customer: SearchPicker with a pinned Add customer row + the existing dialog", () => {
    expect(quoteEditor).toContain('addLabel="Add customer"');
    expect(quoteEditor).toContain("setAddCustomerOpen(true)");
    expect(quoteEditor).toContain("<AddCustomerDialog");
    expect(quoteEditor).not.toContain('<select id="customerId"');
  });
  it("contact: SearchPicker with a pinned Add contact row + the inline dialog (customer owner)", () => {
    expect(quoteEditor).toContain('addLabel="Add contact"');
    expect(quoteEditor).toContain("setAddContactOpen(true)");
    expect(quoteEditor).toContain("<AddContactDialog");
    expect(quoteEditor).toContain('owner={{ kind: "customer", id: customer.id }}');
    expect(quoteEditor).toContain("function onContactAdded");
  });
  it("delivery address: SearchPicker with a pinned Add address row, no in-select option", () => {
    expect(quoteEditor).toContain('addLabel="Add address"');
    expect(quoteEditor).toContain("setAddAddressOpen(true)");
    expect(quoteEditor).not.toContain("Add new address…</option>");
    expect(quoteEditor).not.toContain('<select id="deliveryAddressId"');
  });
  it("supplier: SearchPicker on lines and lot components (desktop + mobile), dialog wired to the asking line", () => {
    expect(quoteEditor.match(/addLabel="Add supplier"/g)).toHaveLength(4);
    expect(quoteEditor).toContain("<AddSupplierDialog");
    expect(quoteEditor).toContain("function onSupplierCreated");
    expect(quoteEditor).toContain("useState(suppliers)");
    expect(quoteEditor).not.toContain("<select id={`sup-");
    expect(quoteEditor).not.toContain("<select id={`comp-sup-");
  });
  it("no beside-field add buttons remain in the quote editor", () => {
    expect(quoteEditor).not.toContain("onClick={() => setAddCustomerOpen(true)}");
    expect(quoteEditor).not.toContain("onClick={() => setAddContactOpen(true)}");
    expect(quoteEditor).not.toContain("onClick={() => setAddAddressOpen(true)}");
  });
});

describe("sales-order editor entry points", () => {
  it("contact: Add contact button + the inline contact dialog (customer owner)", () => {
    expect(docEditor).toContain("setAddContactOpen(true)");
    expect(docEditor).toContain("<AddContactDialog");
    expect(docEditor).toContain('owner={{ kind: "customer", id: customer.id }}');
    expect(docEditor).toContain("function onContactAdded");
  });
});

describe("PO editor entry points", () => {
  it("supplier contact: SearchPicker with a pinned Add contact row + the inline dialog (supplier owner)", () => {
    expect(poEditor).toContain('addLabel="Add contact"');
    expect(poEditor).toContain("setAddContactOpen(true)");
    expect(poEditor).toContain("<AddContactDialog");
    expect(poEditor).toContain('owner={{ kind: "supplier", id: supplier.id }}');
    expect(poEditor).toContain("function onContactAdded");
    expect(poEditor).not.toContain("onClick={() => setAddContactOpen(true)}");
  });
  it("the supplier list is local state so added records can join it", () => {
    expect(poEditor).toContain("useState(suppliers)");
  });
  it("supplier: SearchPicker with a pinned Add supplier row + dialog on the new-PO form", () => {
    expect(poEditor).toContain('addLabel="Add supplier"');
    expect(poEditor).toContain("setAddSupplierOpen(true)");
    expect(poEditor).toContain("<AddSupplierDialog");
    expect(poEditor).toContain("function onSupplierAdded");
    expect(poEditor).not.toContain("onClick={() => setAddSupplierOpen(true)}");
    expect(poEditor).not.toContain('<select id="supplierId"');
  });
});

describe("inline supplier plumbing (PR-2)", () => {
  it("the dialog calls the inline action, which reuses saveSupplier", () => {
    expect(supplierDialog).toContain("createInlineSupplierAction");
    expect(supplierActions).toContain("export async function createInlineSupplierAction");
    const body = supplierActions.slice(supplierActions.indexOf("createInlineSupplierAction"));
    expect(body).toContain("await saveSupplier(null, parsed.data");
    // Bank details are never collected inline: the action blanks them and
    // the dialog has no bank fields (they stay Admin-only on the record).
    expect(body).toContain('bankAccountNumber: ""');
    expect(supplierDialog).not.toContain("bankAccount");
  });
});

describe("inline contact plumbing", () => {
  it("the dialog calls the inline action, which reuses the addContact service", () => {
    expect(contactDialog).toContain("createInlineContactAction");
    expect(contactActions).toContain("export async function createInlineContactAction");
    const body = contactActions.slice(contactActions.indexOf("createInlineContactAction"));
    expect(body).toContain("await addContact(owner, parsed.data, user.id");
    expect(body).toContain("contact: { id: created.id, name: created.name, isMain: created.isMain }");
  });
  it("every editor page passes the Settings contact roles through", () => {
    for (const p of [
      "src/app/(app)/quotes/new/page.tsx",
      "src/app/(app)/quotes/[id]/edit/page.tsx",
      "src/app/(app)/sales-orders/[id]/edit/page.tsx",
      "src/app/(app)/purchase-orders/new/page.tsx",
      "src/app/(app)/purchase-orders/[id]/edit/page.tsx",
    ]) {
      expect(read(p)).toContain("contactRoles=");
    }
  });
});
