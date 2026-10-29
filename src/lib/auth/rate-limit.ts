// Failed-login rate limits, backed by the LoginAttempt table:
// - per email + IP: MAX_FAILED_LOGINS failures in the window;
// - per email from any IP: MAX_FAILED_LOGINS_PER_EMAIL failures, so rotating
//   (or spoofing) IPs can't buy unlimited guesses at one account.
// A successful sign-in clears the count.

import type { Db } from "../db";

export const MAX_FAILED_LOGINS = 5;
export const MAX_FAILED_LOGINS_PER_EMAIL = 20;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
export const TOO_MANY_TRIES = "Too many tries. Wait 15 minutes and try again.";

export type Attempt = { success: boolean; createdAt: Date };
export type IpAttempt = Attempt & { ip: string };

/** Pure rule: blocked if `max` failures within the window since the last success. */
export function isRateLimited(attempts: readonly Attempt[], now: Date = new Date(), max: number = MAX_FAILED_LOGINS): boolean {
  const since = now.getTime() - LOCKOUT_WINDOW_MS;
  const lastSuccess = Math.max(0, ...attempts.filter((a) => a.success).map((a) => a.createdAt.getTime()));
  const failures = attempts.filter(
    (a) => !a.success && a.createdAt.getTime() > since && a.createdAt.getTime() > lastSuccess,
  ).length;
  return failures >= max;
}

/** Pure rule over all recent attempts for one email: the per-IP limit, then the per-email cap. */
export function isLoginBlocked(attempts: readonly IpAttempt[], ip: string, now: Date = new Date()): boolean {
  return (
    isRateLimited(
      attempts.filter((a) => a.ip === ip),
      now,
      MAX_FAILED_LOGINS,
    ) || isRateLimited(attempts, now, MAX_FAILED_LOGINS_PER_EMAIL)
  );
}

export async function checkLoginRateLimit(db: Db, email: string, ip: string, now = new Date()): Promise<boolean> {
  const attempts = await db.loginAttempt.findMany({
    where: { email, createdAt: { gt: new Date(now.getTime() - LOCKOUT_WINDOW_MS) } },
    select: { ip: true, success: true, createdAt: true },
  });
  return isLoginBlocked(attempts, ip, now);
}
