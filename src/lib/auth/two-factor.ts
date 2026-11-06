import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * S-58: the short-lived "password OK, code still needed" state between the
 * two sign-in steps. A signed cookie — userId + expiry + HMAC — never a
 * session: no page loads as signed in until the code is verified.
 */

export const TWO_FACTOR_COOKIE = "hacien_2fa";
const PENDING_MS = 10 * 60 * 1000;

function hmacKey(): string {
  const sessionSecret = process.env.SESSION_SECRET ?? "";
  if (sessionSecret.length < 16) throw new Error("SESSION_SECRET must be at least 16 characters for two-step sign-in.");
  return sessionSecret;
}

export function signPending(userId: string, opts: { rememberMe?: boolean; nowMs?: number } = {}): string {
  const { rememberMe = false, nowMs = Date.now() } = opts;
  // The flag rides in the signed payload (owner 2026-11-07): "Keep me signed
  // in" survives the two-step hop without a second cookie or a re-ask.
  const payload = `${userId}.${rememberMe ? "1" : "0"}.${nowMs + PENDING_MS}`;
  const sig = createHmac("sha256", hmacKey()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyPending(value: string | undefined, nowMs = Date.now()): { userId: string; rememberMe: boolean } | null {
  if (!value) return null;
  const parts = value.split(".");
  let userId: string;
  let flag: string;
  let exp: string;
  let sig: string;
  let payload: string;
  if (parts.length === 3) {
    // Issued before the remember-me flag existed; those cookies expire within
    // 10 minutes anyway, so they carry rememberMe = false.
    [userId, exp, sig] = parts as [string, string, string];
    flag = "0";
    payload = `${userId}.${exp}`;
  } else if (parts.length === 4) {
    [userId, flag, exp, sig] = parts as [string, string, string, string];
    if (flag !== "0" && flag !== "1") return null;
    payload = `${userId}.${flag}.${exp}`;
  } else {
    return null;
  }
  const expected = createHmac("sha256", hmacKey()).update(payload).digest("base64url");
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  if (Number(exp) <= nowMs) return null;
  return { userId, rememberMe: flag === "1" };
}

export async function setPendingCookie(userId: string, rememberMe = false): Promise<void> {
  const jar = await cookies();
  jar.set(TWO_FACTOR_COOKIE, signPending(userId, { rememberMe }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/login/verify",
    maxAge: PENDING_MS / 1000,
  });
}

export async function clearPendingCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(TWO_FACTOR_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/login/verify", maxAge: 0 });
}

export async function readPending(): Promise<{ userId: string; rememberMe: boolean } | null> {
  const jar = await cookies();
  return verifyPending(jar.get(TWO_FACTOR_COOKIE)?.value);
}
