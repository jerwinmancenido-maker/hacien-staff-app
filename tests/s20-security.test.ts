import { describe, expect, it } from "vitest";
import { changePasswordSchema } from "@/lib/auth/password";
import { IDLE_MS, nextIdleExpiry, SESSION_MS, sessionPastIdle } from "@/lib/auth/session";
import {
  assertCanMaintainPurchaseOrder,
  assertCanMarkAdminCheck,
  assertCanVoid,
  can,
  canVoid,
  ForbiddenError,
  roleFlags,
  staffNeedsAdminCheck,
  type PermissionUser,
  type Role,
} from "@/lib/permissions";
import { PAGE_CSP, pageCsp, securityHeaders } from "../next.config";
import {
  PRICE_LOCK_MESSAGE,
  PRICE_OVERRIDE_REASON,
  salesOrderPriceLockError,
  type SoPriceSnapshot,
} from "@/lib/services/sales-orders";

function user(roles: Role[], extra: Partial<PermissionUser> = {}): PermissionUser {
  return { ...roleFlags(roles), active: true, canSeeCosts: false, ...extra };
}

const line = { id: "l1", qty: "1.00", unitPrice: "81500.75" };
const snap = (patch: Partial<SoPriceSnapshot> = {}): SoPriceSnapshot => ({
  contractPrice: "81500.75",
  withholdingTotal: "0.00",
  netReceived: "81500.75",
  lines: [line],
  ...patch,
});

describe("record_billing vs manage_billing", () => {
  it("lets Staff record and keeps void with manage_billing", () => {
    const staff = user(["STAFF"]);
    const admin = user(["ADMIN"]);
    const approver = user(["APPROVER"]);
    const viewer = user(["VIEWER"]);
    expect(can(staff, "record_billing")).toBe(true);
    expect(can(admin, "record_billing")).toBe(true);
    expect(can(approver, "record_billing")).toBe(true);
    expect(can(viewer, "record_billing")).toBe(false);
    expect(can(staff, "manage_billing")).toBe(false);
    expect(can(viewer, "manage_billing")).toBe(false);
    expect(can(admin, "manage_billing")).toBe(true);
    expect(can(approver, "manage_billing")).toBe(true);
    expect(can(user(["STAFF"], { active: false }), "record_billing")).toBe(false);
  });
});

describe("void rights", () => {
  it("allows only an active Admin or Approver", () => {
    expect(canVoid(user(["ADMIN"]))).toBe(true);
    expect(canVoid(user(["APPROVER"]))).toBe(true);
    expect(canVoid(user(["STAFF"]))).toBe(false);
    expect(canVoid(user(["VIEWER"]))).toBe(false);
    expect(canVoid(user(["ADMIN"], { active: false }))).toBe(false);
    expect(canVoid(null)).toBe(false);
    expect(() => assertCanVoid(user(["STAFF"]))).toThrow(ForbiddenError);
    expect(() => assertCanVoid(user(["VIEWER"]))).toThrow(ForbiddenError);
    expect(() => assertCanVoid(user(["ADMIN"]))).not.toThrow();
  });
});

describe("purchase order maintenance and admin check", () => {
  it("lets only an active Admin create or edit a PO, and only an Admin clear the check flag", () => {
    expect(() => assertCanMaintainPurchaseOrder(user(["ADMIN"]))).not.toThrow();
    expect(() => assertCanMaintainPurchaseOrder(user(["APPROVER"]))).toThrow(ForbiddenError);
    expect(() => assertCanMaintainPurchaseOrder(user(["STAFF"]))).toThrow(ForbiddenError);
    expect(() => assertCanMarkAdminCheck(user(["ADMIN"]))).not.toThrow();
    expect(() => assertCanMarkAdminCheck(user(["APPROVER"]))).toThrow(ForbiddenError);
    expect(staffNeedsAdminCheck(user(["STAFF"]))).toBe(true);
    expect(staffNeedsAdminCheck(user(["ADMIN"]))).toBe(false);
    expect(staffNeedsAdminCheck(user(["APPROVER"]))).toBe(false);
    expect(staffNeedsAdminCheck(user(["ADMIN", "STAFF"]))).toBe(false);
  });
});

describe("won sales order price lock", () => {
  const before = snap();

  it("allows a note-only save and refuses a Staff price change", () => {
    expect(salesOrderPriceLockError({ isAdmin: false, reason: "", before, after: snap({ lines: [{ ...line, qty: "1.00" }] }) })).toBeNull();
    const changed = snap({ contractPrice: "81501.50", netReceived: "81501.50", lines: [{ ...line, unitPrice: "81501.50" }] });
    expect(salesOrderPriceLockError({ isAdmin: false, reason: "please", before, after: changed })).toBe(PRICE_LOCK_MESSAGE);
  });

  it("requires an Admin reason and accepts one", () => {
    const changed = snap({ lines: [{ ...line, qty: "2.00" }], contractPrice: "163001.50", netReceived: "163001.50" });
    expect(salesOrderPriceLockError({ isAdmin: true, reason: "  ", before, after: changed })).toBe(PRICE_OVERRIDE_REASON);
    expect(salesOrderPriceLockError({ isAdmin: true, reason: "Quote was 81500.75", before, after: changed })).toBeNull();
  });
});

describe("idle sign-out", () => {
  const start = new Date("2026-11-02T00:00:00.000Z");

  it("expires 30 minutes after the last deadline and never past 7 days", () => {
    expect(IDLE_MS).toBe(30 * 60 * 1000);
    const deadline = nextIdleExpiry(start, start);
    expect(deadline.getTime() - start.getTime()).toBe(IDLE_MS);
    expect(sessionPastIdle({ createdAt: start, expiresAt: deadline, now: new Date(deadline.getTime() - 1) })).toBe(false);
    expect(sessionPastIdle({ createdAt: start, expiresAt: deadline, now: deadline })).toBe(true);
    const late = new Date(start.getTime() + SESSION_MS - 60_000);
    expect(nextIdleExpiry(start, late).getTime()).toBe(start.getTime() + SESSION_MS);
    expect(sessionPastIdle({ createdAt: start, expiresAt: nextIdleExpiry(start, late), now: new Date(start.getTime() + SESSION_MS) })).toBe(true);
  });
});

describe("change password rules", () => {
  it("needs the current password and the same new-password rules as reset", () => {
    expect(changePasswordSchema.safeParse({ current: "", password: "SamplePass123!", confirm: "SamplePass123!" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ current: "OldSample123!", password: "short", confirm: "short" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ current: "OldSample123!", password: "NewSample123!", confirm: "nope" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ current: "OldSample123!", password: "NewSample123!", confirm: "NewSample123!" }).success).toBe(true);
  });
});

describe("security headers", () => {
  it("sets the page headers and keeps file downloads off this CSP", () => {
    const keys = securityHeaders.map((h) => h.key);
    expect(keys).toEqual([
      "Strict-Transport-Security",
      "X-Frame-Options",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Content-Security-Policy",
    ]);
    expect(securityHeaders.find((h) => h.key === "X-Frame-Options")?.value).toBe("DENY");
    expect(securityHeaders.find((h) => h.key === "X-Content-Type-Options")?.value).toBe("nosniff");
    expect(PAGE_CSP).toContain("frame-ancestors 'none'");
    expect(PAGE_CSP).toContain("font-src 'self'");
    expect(PAGE_CSP).toContain("style-src 'self' 'unsafe-inline'");
    expect(PAGE_CSP).not.toContain("unsafe-eval");
    expect(pageCsp("production")).not.toContain("unsafe-eval");
    expect(pageCsp("development")).toContain("'unsafe-eval'");
  });
});
