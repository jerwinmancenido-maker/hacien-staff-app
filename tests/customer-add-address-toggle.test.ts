import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), "utf8");

describe("customer form hides the add-address fields behind a button", () => {
  it("existing customers get an Add address button; new customers show the fields", () => {
    const form = src("src/app/(app)/customers/CustomerForm.tsx");
    // The button reveals the fields.
    expect(form).toContain("Add address");
    expect(form).toContain("onClick={() => setAddAddressOpen(true)}");
    // New customers always show the fields; existing customers only once opened.
    expect(form).toContain("customer == null ||");
    expect(form).toContain("addAddressOpen");
    // The street field lives inside the gate, not at the top level of the form.
    const gate = form.indexOf("{showAddAddress && (");
    const street = form.indexOf('name="street"');
    expect(gate).toBeGreaterThan(-1);
    expect(street).toBeGreaterThan(gate);
  });

  it("a failed save with address errors, or a 2303 prefill, re-opens the fields", () => {
    const form = src("src/app/(app)/customers/CustomerForm.tsx");
    expect(form).toContain("e.street");
    expect(form).toContain("(state.values?.street ?? \"\").trim()");
    expect(form).toContain("if (filledAddress) setAddAddressOpen(true);");
  });

  it("the server creates no address when the fields are absent", () => {
    // The gated fields are simply not submitted; the action only creates an
    // address when a street was sent, and the billing flags default to true.
    const action = src("src/app/(app)/customers/actions.ts");
    expect(action).toContain('if (street.trim()) {');
    expect(action).toContain('form.has("isBilling") ? bool(form, "isBilling") : true');
  });
});
