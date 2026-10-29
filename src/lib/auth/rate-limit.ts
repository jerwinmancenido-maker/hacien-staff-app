// Failed-login rate limit per email + IP, backed by the LoginAttempt table.

import type { Db } from "../db";

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
export const TOO_MANY_TRIES = "Too many tries. Wait 15 minutes and try again.";

export type Attempt = { success: boolean; createdAt: Date };

/** Pure rule: blocked if MAX failures within the window since the last success. */
export function isRateLimited(attempts: readonly Attempt[], now: Date = new Date()): boolean {
  const since = now.getTime() - LOCKOUT_WINDOW_MS;
  const lastSuccess = Math.max(0, ...attempts.filter((a) => a.success).map((a) => a.createdAt.getTime()));
  const failures = attempts.filter(
    (a) => !a.success && a.createdAt.getTime() > since && a.createdAt.getTime() > lastSuccess,
  ).length;
  return failures >= MAX_FAILED_LOGINS;
}

export async function checkLoginRateLimit(db: Db, email: string, ip: string, now = new Date()): Promise<boolean> {
  const attempts = await db.loginAttempt.findMany({
    where: { email, ip, createdAt: { gt: new Date(now.getTime() - LOCKOUT_WINDOW_MS) } },
    select: { success: true, createdAt: true },
  });
  return isRateLimited(attempts, now);
}
