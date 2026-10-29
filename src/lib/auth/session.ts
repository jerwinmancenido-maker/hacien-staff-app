// DB-backed sessions. The cookie holds a random token; the DB stores its HMAC.
// Sign out and "Turn off user" revoke sessions (rows are kept, never deleted).

import { cookies } from "next/headers";
import { db } from "../db";
import { hashToken, randomToken } from "./tokens";

export const SESSION_COOKIE = "hacien_session";
const SESSION_DAYS = 7;

/** Secure cookie in production or whenever the app is served over HTTPS. Plain http://localhost works in dev. */
export function cookieSecure(env: { NODE_ENV?: string; APP_URL?: string } = process.env): boolean {
  return env.NODE_ENV === "production" || /^https:/i.test((env.APP_URL ?? "").trim());
}

export async function createSession(userId: string, meta: { ip?: string; userAgent?: string }) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
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
    expires: expiresAt,
  });
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
  if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.active) return null;
  return session.user;
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
