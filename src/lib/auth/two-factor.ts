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

export function signPending(userId: string, nowMs = Date.now()): string {
  const payload = `${userId}.${nowMs + PENDING_MS}`;
  const sig = createHmac("sha256", hmacKey()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyPending(value: string | undefined, nowMs = Date.now()): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts as [string, string, string];
  const payload = `${userId}.${exp}`;
  const expected = createHmac("sha256", hmacKey()).update(payload).digest("base64url");
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  if (Number(exp) <= nowMs) return null;
  return userId;
}

export async function setPendingCookie(userId: string): Promise<void> {
  const jar = await cookies();
  jar.set(TWO_FACTOR_COOKIE, signPending(userId), {
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

export async function readPendingUserId(): Promise<string | null> {
  const jar = await cookies();
  return verifyPending(jar.get(TWO_FACTOR_COOKIE)?.value);
}
