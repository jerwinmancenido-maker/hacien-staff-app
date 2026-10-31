import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { accountMenuActionKeys, accountMenuNavItems } from "@/lib/account-menu";
import { can, roleFlags, type PermissionUser, type Role } from "@/lib/permissions";

function user(roles: Role[]): PermissionUser {
  return { ...roleFlags(roles), active: true, canSeeCosts: false };
}

describe("account menu items", () => {
  it("always includes Sign out; Settings only when manage_settings is allowed", () => {
    expect(accountMenuActionKeys(true)).toEqual(["settings", "signout"]);
    expect(accountMenuActionKeys(false)).toEqual(["signout"]);
    expect(accountMenuNavItems(false)).toEqual([]);
    expect(accountMenuNavItems(true)).toEqual([{ key: "settings", href: "/settings", label: "Settings" }]);
  });

  it("gates Settings with the same manage_settings permission as the sidebar", () => {
    expect(can(user(["ADMIN"]), "manage_settings")).toBe(true);
    expect(can(user(["STAFF"]), "manage_settings")).toBe(false);
    expect(can(user(["VIEWER"]), "manage_settings")).toBe(false);
    expect(accountMenuActionKeys(can(user(["ADMIN"]), "manage_settings"))).toContain("settings");
    expect(accountMenuActionKeys(can(user(["STAFF"]), "manage_settings"))).not.toContain("settings");
    expect(accountMenuActionKeys(can(user(["STAFF"]), "manage_settings"))).toContain("signout");
  });
});

describe("account menu wiring", () => {
  const root = process.cwd();
  const menuSrc = readFileSync(path.join(root, "src/components/AccountMenu.tsx"), "utf8");
  const layoutSrc = readFileSync(path.join(root, "src/app/(app)/layout.tsx"), "utf8");

  it("removes the top-bar Sign out button and uses AccountMenu instead", () => {
    expect(layoutSrc).toMatch(/<AccountMenu[\s\S]*signOutAction=\{signOut\}/);
    expect(layoutSrc).not.toMatch(/btn-secondary btn-sm[\s\S]*Sign out/);
    expect(layoutSrc).not.toMatch(/LogoutIcon/);
  });

  it("exposes Sign out for every role via a submit control in the menu", () => {
    expect(menuSrc).toMatch(/signOutAction/);
    expect(menuSrc).toMatch(/type="submit"/);
    expect(menuSrc).toMatch(/>\s*Sign out\s*</);
    expect(menuSrc).toMatch(/role="menuitem"/);
  });

  it("hides Settings for non-admins but keeps Sign out", () => {
    expect(menuSrc).toMatch(/showSettings/);
    expect(menuSrc).toMatch(/accountMenuNavItems\(showSettings\)/);
    // Divider then Sign out always rendered (not gated on showSettings).
    expect(menuSrc).toMatch(/account-menu-divider[\s\S]*Sign out/);
  });

  it("supports avatar button a11y and Esc / outside-click close", () => {
    expect(menuSrc).toMatch(/aria-haspopup="menu"/);
    expect(menuSrc).toMatch(/aria-expanded=\{open\}/);
    expect(menuSrc).toMatch(/Escape/);
    expect(menuSrc).toMatch(/mousedown/);
    expect(menuSrc).toMatch(/triggerRef\.current\?\.focus/);
    expect(menuSrc).toMatch(/ArrowDown/);
    expect(menuSrc).toMatch(/ArrowUp/);
  });

  it("outside-click close returns focus to the avatar trigger, same as Escape", () => {
    // Document mousedown outside the menu must both close and restore focus.
    // Focus is deferred (queueMicrotask) so it wins over the browser focusing
    // the mousedown target — Escape focuses immediately.
    const pointer = menuSrc.match(/function onDocPointer[\s\S]*?\n    \}/);
    expect(pointer?.[0]).toMatch(/setOpen\(false\)/);
    expect(pointer?.[0]).toMatch(/queueMicrotask/);
    expect(pointer?.[0]).toMatch(/triggerRef\.current\?\.focus/);
    const escape = menuSrc.match(/function onDocKey[\s\S]*?\n    \}/);
    expect(escape?.[0]).toMatch(/Escape/);
    expect(escape?.[0]).toMatch(/triggerRef\.current\?\.focus/);
  });
});
