// DB-backed sessions. The cookie holds a random token; the DB stores its HMAC.
// Sign out and "Turn off user" revoke sessions (rows are kept, never deleted).

import { cookies } from "next/headers";
import { db } from "../db";
import { hashToken, randomToken } from "./tokens";

export const SESSION_COOKIE = "hacien_session";
/** Absolute session cap, measured from sign-in. */
export const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
/** Idle sign-out. Each signed-in request pushes the deadline forward by this much. */
export const IDLE_MS = 30 * 60 * 1000;
/** "Keep me signed in": idle sign-out for a remembered session. */
export const REMEMBER_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
/** "Keep me signed in": absolute cap for a remembered session. */
export const REMEMBER_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Per-session limits. A remembered session idles out after 7 days and caps
 * at 30 days; anything else keeps today's 30-minute idle / 7-day cap.
 */
export function sessionLimits(rememberMe: boolean): { idleMs: number; maxMs: number } {
  return rememberMe ? { idleMs: REMEMBER_IDLE_MS, maxMs: REMEMBER_SESSION_MS } : { idleMs: IDLE_MS, maxMs: SESSION_MS };
}

/** Next idle deadline, never past createdAt + the 7-day cap. */
export function nextIdleExpiry(createdAt: Date, now: Date, idleMs = IDLE_MS, maxMs = SESSION_MS): Date {
  const cap = createdAt.getTime() + maxMs;
  return new Date(Math.min(cap, now.getTime() + idleMs));
}

/** True when the idle deadline or the 7-day cap has passed. */
export function sessionPastIdle(opts: { createdAt: Date; expiresAt: Date; now: Date }, maxMs = SESSION_MS): boolean {
  if (opts.now.getTime() >= opts.createdAt.getTime() + maxMs) return true;
  return opts.expiresAt.getTime() <= opts.now.getTime();
}

/** Secure cookie in production or whenever the app is served over HTTPS. Plain http://localhost works in dev. */
export function cookieSecure(env: { NODE_ENV?: string; APP_URL?: string } = process.env): boolean {
  return env.NODE_ENV === "production" || /^https:/i.test((env.APP_URL ?? "").trim());
}

export async function createSession(userId: string, meta: { ip?: string; userAgent?: string }, opts: { rememberMe?: boolean } = {}) {
  const token = randomToken();
  const now = new Date();
  const { idleMs, maxMs } = sessionLimits(opts.rememberMe ?? false);
  const absolute = new Date(now.getTime() + maxMs);
  const expiresAt = nextIdleExpiry(now, now, idleMs, maxMs);
  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      rememberMe: opts.rememberMe ?? false,
      ip: meta.ip?.slice(0, 64),
      userAgent: meta.userAgent?.slice(0, 255),
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
    expires: absolute,
  });
}

/**
 * Milliseconds left before this session's idle deadline, without sliding it.
 * 0 when there is no live session. Used by an idle tab so another tab's
 * activity keeps the shared session. Does not write the cookie.
 */
export async function idleRemainingMs(): Promise<number> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return 0;
  const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session || session.revokedAt) return 0;
  const now = new Date();
  const { maxMs } = sessionLimits(session.rememberMe);
  if (sessionPastIdle({ createdAt: session.createdAt, expiresAt: session.expiresAt, now }, maxMs)) {
    await db.session.updateMany({
      where: { tokenHash: session.tokenHash, revokedAt: null },
      data: { revokedAt: now },
    });
    return 0;
  }
  return Math.max(0, session.expiresAt.getTime() - now.getTime());
}

/** HMAC of the current cookie, so a password change can keep this session. */
export async function currentTokenHash(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return hashToken(token);
}

/** The active session's user, or null. Checks expiry, revocation and user.active. */
export async function getSessionUser() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || !session.user.active) return null;
  const now = new Date();
  const { idleMs, maxMs } = sessionLimits(session.rememberMe);
  if (sessionPastIdle({ createdAt: session.createdAt, expiresAt: session.expiresAt, now }, maxMs)) {
    // Revoke only. Cookie writes are not allowed in a Server Component, and this
    // lookup runs from page renders. The row is dead, so the next render redirects
    // to login. Sign out (a Server Action) is what clears the cookie.
    await db.session.updateMany({
      where: { tokenHash: session.tokenHash, revokedAt: null },
      data: { revokedAt: now },
    });
    return null;
  }
  const expiresAt = nextIdleExpiry(session.createdAt, now, idleMs, maxMs);
  if (expiresAt.getTime() !== session.expiresAt.getTime()) {
    await db.session.update({ where: { id: session.id }, data: { expiresAt } });
  }
  return session.user;
}

/** The current session's limits, so the idle timer can arm for the right span. Signed out = standard limits. */
export async function currentSessionLimits(): Promise<{ idleMs: number; maxMs: number }> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return sessionLimits(false);
  const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, select: { rememberMe: true } });
  return sessionLimits(session?.rememberMe ?? false);
}

export async function destroyCurrentSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  jar.delete(SESSION_COOKIE);
}
