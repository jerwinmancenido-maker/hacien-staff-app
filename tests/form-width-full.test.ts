import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * New-record forms are full width (Miller, 2026-11-05): the 760px card cap
 * left the right side of a wide screen empty on /customers/new. The four
 * forms already lay out in two columns (.form-grid), so dropping the cap is
 * the whole fix — the edit pages already render the same forms full width.
 * Follow-up (Miller, 2026-11-05 ~23:35, from a Record billing screenshot):
 * the same fixed cap (720/800/960px) was still on six more record pages —
 * record billing, record collection, and the cash pages — so they are
 * covered here too.
 */
const NEW_PAGES = [
  "src/app/(app)/customers/new/page.tsx",
  "src/app/(app)/suppliers/new/page.tsx",
  "src/app/(app)/contacts/new/page.tsx",
  "src/app/(app)/settings/users/new/page.tsx",
  "src/app/(app)/billing/billings/new/page.tsx",
  "src/app/(app)/billing/collections/new/page.tsx",
  "src/app/(app)/cash/accounts/new/page.tsx",
  "src/app/(app)/cash/accounts/[id]/page.tsx",
  "src/app/(app)/cash/expenses/new/page.tsx",
  "src/app/(app)/cash/transfers/new/page.tsx",
];

const FORMS = [
  "src/app/(app)/customers/CustomerForm.tsx",
  "src/app/(app)/suppliers/SupplierForm.tsx",
  "src/app/(app)/contacts/ContactForm.tsx",
  "src/app/(app)/settings/UserForm.tsx",
];

describe("new-record forms are full width", () => {
  it.each(NEW_PAGES)("no width cap on the %s card", (page) => {
    const f = src(page);
    expect(f).not.toContain("maxWidth");
    expect(f).toContain('<div className="card">');
  });

  it.each(FORMS)("the %s form lays out in two columns", (form) => {
    expect(src(form)).toContain('className="form-grid"');
  });
});
