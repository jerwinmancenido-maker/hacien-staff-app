import { describe, expect, it } from "vitest";
import { changePasswordSchema } from "@/lib/auth/password";
import { isLoginBlocked, LOGIN_ATTEMPT_EMAIL_MAX, MAX_FAILED_LOGINS, passwordChangeAttemptEmail } from "@/lib/auth/rate-limit";
import { IDLE_MS, nextIdleExpiry, REMEMBER_IDLE_MS, REMEMBER_SESSION_MS, SESSION_MS, sessionLimits, sessionPastIdle } from "@/lib/auth/session";
import { DocRuleError } from "@/lib/documents/common";
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
import { PAGE_CSP, pageCsp, securityHeaders } from "../src/lib/security-headers";
import { voidBilling } from "@/lib/services/billings";
import { voidCollection } from "@/lib/services/collections";
import { voidPurchaseOrder } from "@/lib/services/purchase-orders";
import { voidQuote } from "@/lib/services/quotes";
import { voidReceivingReport } from "@/lib/services/receiving";
import {
  PRICE_LOCK_MESSAGE,
  PRICE_OVERRIDE_REASON,
  salesOrderPriceLockError,
  voidSalesOrder,
  type SoPriceSnapshot,
} from "@/lib/services/sales-orders";

function user(roles: Role[], extra: Partial<PermissionUser & { id: string }> = {}): PermissionUser & { id: string } {
  return { id: "test-actor-id", ...roleFlags(roles), active: true, canSeeCosts: false, ...extra };
}

const line = { id: "l1", qty: "1.00", unitPrice: "81500.75", kind: "GOODS", withholdingRate: "0.0100", withholdingAtc: "WI158" };
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

  it("requires a void reason of at least 3 characters on all void services", async () => {
    const admin = user(["ADMIN"], { canSeeCosts: true });
    const approver = user(["APPROVER"], { canSeeCosts: true });

    // 2-character reasons must be rejected by voidReasonSchema with DocRuleError
    await expect(voidSalesOrder("so1", "no", admin)).rejects.toThrow(DocRuleError);
    await expect(voidSalesOrder("so1", "no", admin)).rejects.toThrow(/at least 3 characters/i);
    await expect(voidQuote("q1", "no", admin)).rejects.toThrow(DocRuleError);
    await expect(voidQuote("q1", "no", admin)).rejects.toThrow(/at least 3 characters/i);
    await expect(voidBilling("b1", "no", approver)).rejects.toThrow(DocRuleError);
    await expect(voidBilling("b1", "no", approver)).rejects.toThrow(/at least 3 characters/i);
    await expect(voidCollection("c1", "no", approver)).rejects.toThrow(DocRuleError);
    await expect(voidCollection("c1", "no", approver)).rejects.toThrow(/at least 3 characters/i);
    await expect(voidPurchaseOrder("po1", "no", admin)).rejects.toThrow(DocRuleError);
    await expect(voidPurchaseOrder("po1", "no", admin)).rejects.toThrow(/at least 3 characters/i);
    await expect(voidReceivingReport("rr1", "no", admin)).rejects.toThrow(DocRuleError);
    await expect(voidReceivingReport("rr1", "no", admin)).rejects.toThrow(/at least 3 characters/i);
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
    const rewrittenCode = snap({ lines: [{ ...line, withholdingAtc: "WI160", withholdingRate: "0.0200" }] });
    expect(salesOrderPriceLockError({ isAdmin: false, reason: "", before, after: rewrittenCode })).toBe(PRICE_LOCK_MESSAGE);
    const rewrittenKind = snap({ lines: [{ ...line, kind: "SERVICES" }] });
    expect(salesOrderPriceLockError({ isAdmin: false, reason: "", before, after: rewrittenKind })).toBe(PRICE_LOCK_MESSAGE);
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

  it("remembered sessions idle out after 7 days and cap at 30 days", () => {
    const limits = sessionLimits(true);
    expect(limits).toEqual({ idleMs: REMEMBER_IDLE_MS, maxMs: REMEMBER_SESSION_MS });
    expect(REMEMBER_IDLE_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(REMEMBER_SESSION_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(sessionLimits(false)).toEqual({ idleMs: IDLE_MS, maxMs: SESSION_MS });
    const deadline = nextIdleExpiry(start, start, limits.idleMs, limits.maxMs);
    expect(deadline.getTime() - start.getTime()).toBe(REMEMBER_IDLE_MS);
    // 8 days after sign-in with a fresh deadline: still alive — a standard
    // session is already dead at its 7-day cap.
    const eightDays = new Date(start.getTime() + 8 * 24 * 60 * 60 * 1000);
    expect(
      sessionPastIdle(
        { createdAt: start, expiresAt: nextIdleExpiry(start, eightDays, limits.idleMs, limits.maxMs), now: eightDays },
        limits.maxMs,
      ),
    ).toBe(false);
    expect(sessionPastIdle({ createdAt: start, expiresAt: nextIdleExpiry(start, eightDays), now: eightDays })).toBe(true);
    // 31 days after sign-in: past the 30-day cap even with a fresh deadline.
    const thirtyOne = new Date(start.getTime() + 31 * 24 * 60 * 60 * 1000);
    expect(
      sessionPastIdle(
        { createdAt: start, expiresAt: nextIdleExpiry(start, thirtyOne, limits.idleMs, limits.maxMs), now: thirtyOne },
        limits.maxMs,
      ),
    ).toBe(true);
  });
});

describe("change password rules", () => {
  it("needs the current password and the same new-password rules as reset", () => {
    expect(changePasswordSchema.safeParse({ current: "", password: "SamplePass123!", confirm: "SamplePass123!" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ current: "OldSample123!", password: "short", confirm: "short" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ current: "OldSample123!", password: "NewSample123!", confirm: "nope" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ current: "OldSample123!", password: "NewSample123!", confirm: "NewSample123!" }).success).toBe(true);
  });

  it("fits the password-change rate key in the login attempt column", () => {
    const short = "staff@example.com";
    expect(passwordChangeAttemptEmail(short)).toBe(`pwd:${short}`);
    const long = `${"a".repeat(179)}@example.com`;
    expect(long.length).toBe(191);
    const key = passwordChangeAttemptEmail(long);
    expect(key.length).toBeLessThanOrEqual(LOGIN_ATTEMPT_EMAIL_MAX);
    expect(key.startsWith("pwd:")).toBe(true);
    expect(key).not.toBe(`pwd:${long}`);
  });

  it("denies repeated wrong current passwords under the login rate limiter", () => {
    const now = new Date("2026-11-02T12:00:00.000Z");
    const ip = "192.0.2.1";
    const failAttempt = (minAgo = 1) => ({ ip, success: false, createdAt: new Date(now.getTime() - minAgo * 60_000) });
    const attempts = Array.from({ length: MAX_FAILED_LOGINS }, (_, i) => failAttempt(i + 1));
    expect(isLoginBlocked(attempts, ip, now)).toBe(true);
    expect(isLoginBlocked(attempts.slice(0, MAX_FAILED_LOGINS - 1), ip, now)).toBe(false);
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
    // Browser Sentry events POST to the ingest host; without this the
    // browser blocks the send. Harmless when no DSN is set.
    expect(PAGE_CSP).toContain("connect-src 'self' https://*.ingest.sentry.io");
    expect(PAGE_CSP).not.toContain("unsafe-eval");
    expect(pageCsp("production")).not.toContain("unsafe-eval");
    expect(pageCsp("development")).toContain("'unsafe-eval'");
  });
});
