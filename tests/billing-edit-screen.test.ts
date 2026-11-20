import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Phase 2 D5 (decided by Jerwin 2026-11-13): the billing-edit screen.
// The backend updateBilling service already existed and is fully guarded;
// D5 adds only the UI. These tests pin the wiring so the screen cannot
// quietly drift away from the guarded action or show up where the
// service would refuse the edit anyway.

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("D5 billing edit screen", () => {
  it("the edit page posts to the existing guarded updateBillingAction", () => {
    const src = read("src/app/(app)/billing/billings/[id]/edit/page.tsx");
    expect(src).toContain("updateBillingAction.bind(null, id)");
    expect(src).toContain("BillingForm");
    expect(src).toContain('submitLabel="Save changes"');
    // No file uploads on edit: updateBilling takes no files.
    expect(src).toContain("showFiles={false}");
  });

  it("the edit page is gated on manage_billing and refuses VOID billings", () => {
    const src = read("src/app/(app)/billing/billings/[id]/edit/page.tsx");
    expect(src).toContain('can(user, "manage_billing")');
    expect(src).toContain('b.status === "VOID"');
  });

  it("the edit page mirrors the service guards (posted collections, closed SO)", () => {
    const src = read("src/app/(app)/billing/billings/[id]/edit/page.tsx");
    expect(src).toContain("This billing has posted collections; void those first before editing.");
    expect(src).toContain("The sales order is closed or void; this billing can't be edited.");
  });

  it("the edit cap excludes this billing itself (remaining computed over the others)", () => {
    const src = read("src/app/(app)/billing/billings/[id]/edit/page.tsx");
    expect(src).toContain("id: { not: id }");
    expect(src).toContain("remainingToBill(");
  });

  it("the billing detail page links to the edit screen for managers on non-void billings", () => {
    const src = read("src/app/(app)/billing/billings/[id]/page.tsx");
    expect(src).toContain("/billing/billings/${id}/edit");
    expect(src).toContain('canManage && b.status !== "VOID"');
    expect(src).toContain("Edit billing");
  });

  it("BillingForm only renders the scan upload when showFiles is on (default)", () => {
    const src = read("src/components/billing/BillingForm.tsx");
    expect(src).toContain("showFiles = true");
    expect(src).toContain("{showFiles && (");
    expect(src).toContain("Scan of filled-in booklet (optional)");
  });

  it("the action behind the screen still requires manage_billing", () => {
    const src = read("src/app/(app)/billing/actions.ts");
    expect(src).toContain("updateBillingAction");
    expect(src).toContain('requireActionPermission("manage_billing")');
  });
});
