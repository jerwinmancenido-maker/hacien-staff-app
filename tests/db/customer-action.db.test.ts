// F38 (found in the Release 8 rehearsal S44 closing check, 2026-11-21):
// the duplicate-customer-name warning carried confirmDuplicateName=1 as a
// hidden field in the shared form, so ANY resubmit — the main Save button
// included — confirmed the duplicate. The confirmation must count only
// when it arrives as the explicit "1" the Save-anyway button sets; a
// resubmit with the field blank (what the main Save sends) must re-issue
// the warning and save nothing. These tests call the ACTION itself.
// Runs on MySQL 8 (TEST_DATABASE_URL); skipped locally without it.

import { beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

const actor = vi.hoisted(() => ({ id: "" }));

vi.mock("@/lib/auth/current-user", () => ({
  requireActionPermission: async () => ({ id: actor.id, isAdmin: true }),
  requireUser: async () => ({ id: actor.id, isAdmin: true }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

import { db } from "@/lib/db";
import { saveCustomerAction } from "@/app/(app)/customers/actions";
import { loadCustomerWriteOptions } from "@/lib/services/companies";
import { makeUser, tag } from "./fixtures";

const run = env.hasDb ? describe : describe.skip;

let firstTerm = "";

function customerForm(name: string, confirm?: string): FormData {
  const fd = new FormData();
  fd.set("name", name);
  fd.set("tin", "");
  fd.set("withholdingType", "NONE");
  fd.set("defaultTerms", firstTerm);
  fd.set("creditLimit", "");
  fd.set("notes", "");
  fd.set("customerKind", "business");
  if (confirm !== undefined) fd.set("confirmDuplicateName", confirm);
  return fd;
}

async function countNamed(name: string): Promise<number> {
  return db.customer.count({ where: { name } });
}

run("saveCustomerAction duplicate-name confirmation (F38)", () => {
  beforeAll(async () => {
    const admin = await makeUser("costs");
    actor.id = admin.id;
    const opts = await loadCustomerWriteOptions(null);
    firstTerm = opts.allowedTerms[0] ?? "";
  });

  it("creates the first customer with that name without any confirmation", async () => {
    const name = `F38 Original ${tag()}`;
    const result = await saveCustomerAction(null, {}, customerForm(name));
    expect(result.ok).toBe(true);
    expect(await countNamed(name)).toBe(1);
  });

  it("warns and saves nothing when the duplicate is submitted with no confirmation field", async () => {
    const name = `F38 NoField ${tag()}`;
    expect((await saveCustomerAction(null, {}, customerForm(name))).ok).toBe(true);
    const dupe = await saveCustomerAction(null, {}, customerForm(name));
    expect(dupe.ok).toBeUndefined();
    expect(dupe.warning ?? "").toContain("already exists");
    expect(await countNamed(name)).toBe(1);
  });

  it("warns again and saves nothing when the resubmit carries a blank confirmation (the main Save path)", async () => {
    const name = `F38 Blank ${tag()}`;
    expect((await saveCustomerAction(null, {}, customerForm(name))).ok).toBe(true);
    const first = await saveCustomerAction(null, {}, customerForm(name, ""));
    expect(first.warning ?? "").toContain("already exists");
    // The old bug: the warning's own form resubmitted "1" from a hidden
    // field, so this second submit saved the duplicate. Blank must not.
    const second = await saveCustomerAction(null, {}, customerForm(name, ""));
    expect(second.ok).toBeUndefined();
    expect(second.warning ?? "").toContain("already exists");
    expect(await countNamed(name)).toBe(1);
  });

  it("saves the duplicate only on the explicit Save-anyway confirmation", async () => {
    const name = `F38 Anyway ${tag()}`;
    expect((await saveCustomerAction(null, {}, customerForm(name))).ok).toBe(true);
    const dupe = await saveCustomerAction(null, {}, customerForm(name, "1"));
    expect(dupe.ok).toBe(true);
    expect(await countNamed(name)).toBe(2);
  });
});
