import { describe, expect, it } from "vitest";
import { can, canSeeCosts, lastRoleGuard, roleFlags, stripCosts, type GuardUser, type Permission, type PermissionUser, type Role } from "@/lib/permissions";

function user(roles: Role[], extra: Partial<PermissionUser> = {}): PermissionUser {
  return { ...roleFlags(roles), active: true, canSeeCosts: false, ...extra };
}

describe("role permissions", () => {
  const matrix: [Role, Permission[], Permission[]][] = [
    ["ADMIN", ["view", "edit_data", "approve", "manage_billing", "manage_payables", "manage_cash", "view_books", "manage_settings", "manage_users", "view_audit"], []],
    ["APPROVER", ["view", "edit_data", "approve", "manage_billing", "manage_payables", "manage_cash", "view_books"], ["manage_settings", "manage_users", "view_audit"]],
    ["STAFF", ["view", "edit_data"], ["approve", "manage_billing", "manage_payables", "manage_cash", "view_books", "manage_settings", "manage_users", "view_audit"]],
    ["VIEWER", ["view"], ["edit_data", "approve", "manage_billing", "manage_payables", "manage_cash", "view_books", "manage_settings", "manage_users", "view_audit"]],
  ];

  it.each(matrix)("%s has exactly its permissions", (role, allowed, denied) => {
    const u = user([role]);
    for (const p of allowed) expect(can(u, p), `${role} should ${p}`).toBe(true);
    for (const p of denied) expect(can(u, p), `${role} should not ${p}`).toBe(false);
  });

  it("combines roles (Admin + Approver)", () => {
    const jerwin = user(["ADMIN", "APPROVER"]);
    expect(can(jerwin, "manage_settings")).toBe(true);
    expect(can(jerwin, "approve")).toBe(true);
  });

  it("gives a turned-off user no permissions", () => {
    const off = user(["ADMIN", "APPROVER"], { active: false });
    for (const p of ["view", "edit_data", "approve", "manage_settings"] as Permission[]) expect(can(off, p)).toBe(false);
  });

  it("denies when signed out", () => {
    expect(can(null, "view")).toBe(false);
  });
});

describe("canSeeCosts", () => {
  it("is true only with the flag on an active user", () => {
    expect(canSeeCosts(user(["STAFF"], { canSeeCosts: true }))).toBe(true);
    expect(canSeeCosts(user(["STAFF"], { canSeeCosts: false }))).toBe(false);
    expect(canSeeCosts(user(["STAFF"], { canSeeCosts: true, active: false }))).toBe(false);
    expect(canSeeCosts(null)).toBe(false);
  });

  it("does not come with the Admin role by itself", () => {
    expect(canSeeCosts(user(["ADMIN", "APPROVER"]))).toBe(false);
  });

  it("stripCosts removes cost fields (deeply) for users without the flag", () => {
    const quote = { total: 510000, cost: 450000, margin: 60000, lines: [{ qty: 10, price: 52000, unitCost: 45000, marginPct: 11.8 }] };
    expect(stripCosts(quote, user(["STAFF"]))).toEqual({ total: 510000, lines: [{ qty: 10, price: 52000 }] });
    expect(stripCosts(quote, user(["STAFF"], { canSeeCosts: true }))).toEqual(quote);
  });
});

describe("last Admin / last Approver guard", () => {
  const u = (id: string, roles: Role[], active = true): GuardUser => ({ id, active, ...roleFlags(roles) });

  it("blocks turning off the last approver", () => {
    const users = [u("jerwin", ["ADMIN", "APPROVER"]), u("maria", ["STAFF"]), u("ana", ["ADMIN"])];
    expect(lastRoleGuard(users, "jerwin", { ...roleFlags(["ADMIN", "APPROVER"]), active: false })).toBe("Can't turn off the last approver.");
  });

  it("blocks turning off the last admin", () => {
    const users = [u("jerwin", ["ADMIN"]), u("ben", ["APPROVER"])];
    expect(lastRoleGuard(users, "jerwin", { ...roleFlags(["ADMIN"]), active: false })).toBe("Can't turn off the last admin.");
  });

  it("blocks demoting the last admin or approver", () => {
    const users = [u("jerwin", ["ADMIN", "APPROVER"]), u("maria", ["STAFF"])];
    expect(lastRoleGuard(users, "jerwin", { ...roleFlags(["ADMIN"]), active: true })).toMatch(/last approver/);
    expect(lastRoleGuard(users, "jerwin", { ...roleFlags(["APPROVER"]), active: true })).toMatch(/last admin/);
  });

  it("ignores turned-off users when counting", () => {
    const users = [u("jerwin", ["ADMIN", "APPROVER"]), u("old", ["ADMIN", "APPROVER"], false)];
    expect(lastRoleGuard(users, "jerwin", { ...roleFlags(["ADMIN", "APPROVER"]), active: false })).not.toBeNull();
  });

  it("allows the change when another active admin and approver remain", () => {
    const users = [u("jerwin", ["ADMIN", "APPROVER"]), u("ana", ["ADMIN", "APPROVER"]), u("maria", ["STAFF"])];
    expect(lastRoleGuard(users, "jerwin", { ...roleFlags(["ADMIN", "APPROVER"]), active: false })).toBeNull();
    expect(lastRoleGuard(users, "maria", { ...roleFlags(["STAFF"]), active: false })).toBeNull();
  });
});
