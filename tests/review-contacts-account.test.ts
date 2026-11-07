import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Missing-pages guard (page review, Nov 2026): /contacts and /account both
 * 404'd — there was no contacts list page and no My account page, only the
 * detail/form routes under them. ContactCards also fell back to a bare
 * "/contacts/new" link (which 404s by design without an owner), and the
 * breadcrumb had no labels for account/password/two-step, so those pages
 * showed "HACIEN / Staff / Record".
 */
const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

describe("contacts list page and account page exist", () => {
  it("adds a /contacts page that lists every contact with its company", () => {
    const page = read("src/app/(app)/contacts/page.tsx");
    expect(page).toContain('requirePagePermission("view")');
    expect(page).toContain("listAllContacts");
    expect(page).toContain("showOwner");
  });

  it("adds a read-only /account page linking to password and two-step", () => {
    expect(existsSync(path.join(process.cwd(), "src/app/(app)/account/page.tsx"))).toBe(true);
    const page = read("src/app/(app)/account/page.tsx");
    expect(page).toContain("roleLabel");
    expect(page).toContain('href="/account/password"');
    expect(page).toContain('href="/account/two-step"');
  });

  it("never links to the bare /contacts/new (it 404s without an owner)", () => {
    const cards = read("src/components/ContactCards.tsx");
    expect(cards).not.toContain('"/contacts/new"');
    expect(cards).toContain("`/contacts/new?${ownerKind}=${ownerId}`");
  });

  it("gives the account pages real breadcrumb labels instead of Record", () => {
    const sidebar = read("src/components/Sidebar.tsx");
    expect(sidebar).toContain('account: "My account"');
    expect(sidebar).toContain('password: "Change password"');
    expect(sidebar).toContain('"two-step": "Two-step sign-in"');
  });
});
