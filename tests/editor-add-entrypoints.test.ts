import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Add-entry-points sweep (2026-11-08): a create action must never hide as an
// option inside a data dropdown — once a record is picked, the native popup
// opens at the selection and the top rows are out of sight, so staff could
// not add a customer from the quote editor. Every editor now carries a
// visible "Add …" button beside the field instead.
const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const quoteEditor = read("src/components/docs/QuoteEditor.tsx");
const docEditor = read("src/components/docs/DocumentEditor.tsx");
const poEditor = read("src/components/purchasing/PoEditor.tsx");
const contactDialog = read("src/components/docs/AddContactDialog.tsx");
const contactActions = read("src/app/(app)/contacts/actions.ts");

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

describe("quote editor entry points", () => {
  it("customer: visible Add customer button opens the existing dialog", () => {
    expect(quoteEditor).toContain("setAddCustomerOpen(true)");
    expect(quoteEditor).toContain("Add customer");
  });
  it("delivery address: visible Add address button, no in-select option", () => {
    expect(quoteEditor).toContain("setAddAddressOpen(true)");
    expect(quoteEditor).toContain("Add address");
    expect(quoteEditor).not.toContain("Add new address…</option>");
  });
  it("contact: Add contact button + the inline contact dialog (customer owner)", () => {
    expect(quoteEditor).toContain("setAddContactOpen(true)");
    expect(quoteEditor).toContain("<AddContactDialog");
    expect(quoteEditor).toContain('owner={{ kind: "customer", id: customer.id }}');
    expect(quoteEditor).toContain("function onContactAdded");
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
  it("supplier contact: Add contact button + the inline contact dialog (supplier owner)", () => {
    expect(poEditor).toContain("setAddContactOpen(true)");
    expect(poEditor).toContain("<AddContactDialog");
    expect(poEditor).toContain('owner={{ kind: "supplier", id: supplier.id }}');
    expect(poEditor).toContain("function onContactAdded");
  });
  it("the supplier list is local state so added records can join it", () => {
    expect(poEditor).toContain("useState(suppliers)");
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
