import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  base32Decode,
  base32Encode,
  decryptTotpSecret,
  encryptTotpSecret,
  newTotpSecret,
  totpCode,
  verifyTotpCode,
} from "@/lib/auth/totp";
import { signPending, verifyPending } from "@/lib/auth/two-factor";
import { canSeeTin, roleFlags } from "@/lib/permissions";
import { accessReviewDue, accessReviewLabel } from "@/lib/access-review";

process.env.SESSION_SECRET = "test-secret-at-least-16-chars";

const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), "utf8");

describe("S-58 TOTP (RFC 6238 test vectors, SHA-1, 6 digits)", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  it("matches the RFC vectors", () => {
    expect(totpCode(secret, 59)).toBe("287082");
    expect(totpCode(secret, 1111111109)).toBe("081804");
    expect(totpCode(secret, 1111111111)).toBe("050471");
    expect(totpCode(secret, 1234567890)).toBe("005924");
    expect(totpCode(secret, 2000000000)).toBe("279037");
    expect(totpCode(secret, 20000000000)).toBe("353130");
  });

  it("accepts one step of clock skew, rejects the rest", () => {
    const now = 1_700_000_000;
    expect(verifyTotpCode(secret, totpCode(secret, now - 30), now)).toBe(true);
    expect(verifyTotpCode(secret, totpCode(secret, now + 30), now)).toBe(true);
    expect(verifyTotpCode(secret, totpCode(secret, now + 60), now)).toBe(false);
    expect(verifyTotpCode(secret, "12345", now)).toBe(false);
    expect(verifyTotpCode(secret, "abcdef", now)).toBe(false);
  });

  it("base32 round-trips and rejects bad characters", () => {
    const bytes = Buffer.from("12345678901234567890", "ascii");
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    expect(() => base32Decode("GEZ!")).toThrow();
  });

  it("new secrets are 32 base32 chars", () => {
    expect(newTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("encrypts the stored secret and decrypts it back", () => {
    const stored = encryptTotpSecret(secret);
    expect(stored).not.toContain(secret);
    expect(decryptTotpSecret(stored)).toBe(secret);
    expect(() => decryptTotpSecret("not-a-secret")).toThrow();
  });
});

describe("S-58 pending sign-in cookie", () => {
  it("verifies, rejects tampering, and expires", () => {
    const now = 1_700_000_000_000;
    const cookie = signPending("user-1", { nowMs: now });
    expect(verifyPending(cookie, now)).toEqual({ userId: "user-1", rememberMe: false });
    expect(verifyPending(cookie.replace(/.$/, "x"), now)).toBe(null);
    expect(verifyPending(cookie, now + 11 * 60 * 1000)).toBe(null);
    expect(verifyPending(undefined, now)).toBe(null);
  });

  it("carries the remember-me flag through the two-step hop", () => {
    const now = 1_700_000_000_000;
    expect(verifyPending(signPending("user-1", { rememberMe: true, nowMs: now }), now)).toEqual({
      userId: "user-1",
      rememberMe: true,
    });
    expect(verifyPending(signPending("user-1", { rememberMe: false, nowMs: now }), now)).toEqual({
      userId: "user-1",
      rememberMe: false,
    });
    // A tampered flag fails the signature.
    const tampered = signPending("user-1", { rememberMe: true, nowMs: now }).replace(".1.", ".0.");
    expect(verifyPending(tampered, now)).toBe(null);
  });

  it("still accepts a cookie issued before the flag existed", () => {
    const now = 1_700_000_000_000;
    const payload = `user-1.${now + 10 * 60 * 1000}`;
    // The old 3-part format, signed with the same secret the verifier reads.
    const sig = createHmac("sha256", process.env.SESSION_SECRET ?? "").update(payload).digest("base64url");
    expect(verifyPending(`${payload}.${sig}`, now)).toEqual({ userId: "user-1", rememberMe: false });
  });
});

describe("S-58 TIN visibility + access review cadence", () => {
  it("view-only users cannot see TINs; staff and admins can", () => {
    expect(canSeeTin({ ...roleFlags(["VIEWER"]), active: true, canSeeCosts: false })).toBe(false);
    expect(canSeeTin({ ...roleFlags(["STAFF"]), active: true, canSeeCosts: false })).toBe(true);
    expect(canSeeTin({ ...roleFlags(["ADMIN"]), active: true, canSeeCosts: false })).toBe(true);
    expect(canSeeTin({ ...roleFlags(["STAFF"]), active: false, canSeeCosts: false })).toBe(false);
  });

  it("review is due when never reviewed or more than 90 days ago", () => {
    const now = new Date("2026-11-04T00:00:00.000Z");
    expect(accessReviewDue(null, now)).toBe(true);
    expect(accessReviewDue(new Date("2026-11-04T00:00:00.000Z"), now)).toBe(false);
    expect(accessReviewDue(new Date("2026-08-06T00:00:00.000Z"), now)).toBe(false);
    expect(accessReviewDue(new Date("2026-08-05T00:00:00.000Z"), now)).toBe(true);
    expect(accessReviewLabel(null, now)).toBe("Never reviewed");
    expect(accessReviewLabel(new Date("2026-11-04T00:00:00.000Z"), now)).toBe("Reviewed today");
  });
});

describe("S-58 wiring", () => {
  it("sign-in branches to the verify step when a secret is set", () => {
    const actions = src("src/app/auth-actions.ts");
    expect(actions).toContain('redirect("/login/verify")');
    expect(actions).toContain("verifyTwoFactor");
    expect(actions).toContain("login_2fa_pending");
  });

  it("TINs are gated on lists, details, forms and prints", () => {
    expect(src("src/app/(app)/customers/page.tsx")).toContain("matchTin: showTin");
    expect(src("src/app/(app)/suppliers/page.tsx")).toContain("matchTin: showTin");
    expect(src("src/components/CustomerOverview.tsx")).toContain("canSeeTin");
    expect(src("src/components/SupplierOverview.tsx")).toContain("canSeeTin");
    expect(src("src/app/(app)/customers/CustomerForm.tsx")).toContain('canSeeTin ? v("tin") : ""');
    expect(src("src/components/docs/PrintShell.tsx")).toContain("hideCounterpartyTin");
    expect(src("src/app/print/quotes/[id]/page.tsx")).toContain("hideCounterpartyTin={!canSeeTin(user)}");
  });

  it("access review has a card, an action, and an admin reset for two-step", () => {
    expect(src("src/app/(app)/settings/AccessReviewCard.tsx")).toContain("Mark access reviewed today");
    expect(src("src/app/(app)/settings/actions.ts")).toContain("markAccessReviewedAction");
    expect(src("src/app/(app)/settings/actions.ts")).toContain("resetTwoFactorAction");
    expect(src("src/app/(app)/account/two-step/page.tsx")).toContain("Two-step sign-in");
  });

  it("bell shows an access-review section for Admins when a review is due", () => {
    const bell = src("src/lib/notifications.ts");
    expect(bell).toContain('can(user, "manage_settings")');
    expect(bell).toContain("accessReviewDue");
    expect(bell).toContain('key: "access-review"');
    expect(bell).toContain('href: "/settings?tab=users"');
    expect(bell).toContain("Review who can sign in and with which roles");
  });
});
