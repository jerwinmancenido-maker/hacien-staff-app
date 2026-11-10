import { db } from "../db";

/**
 * The dedicated acting user for /api/v1 (REQ-API-001 decision 3): every API
 * key acts as this one user, so a key can never do more than this user's UI
 * permissions allow, and audit rows read "API / Bot".
 *
 * Flags (plan v2): Staff role only — view + edit_data + record_billing via
 * the Staff role; NOT admin, NOT approver, no manage_billing (voids stay
 * UI-only), canSeeCosts OFF (API responses strip costs). canSeeTin follows
 * edit_data, so TINs stay visible to the API (plan v2 decision of record).
 *
 * The account can never sign in: passwordHash stays null, the Users screens
 * hide it from invite / reset / edit (services/users.ts refuses those
 * operations for this address), and ensureApiBotUser re-locks the flags on
 * every call, so a tampered row heals instead of quietly raising every
 * key's ceiling.
 */
export const API_BOT_EMAIL = "api-bot@haciensolutions.com";
export const API_BOT_NAME = "API / Bot";

/** The bot's locked shape — the single source for the seed and ensure. */
export const API_BOT_FLAGS = {
  isAdmin: false,
  isApprover: false,
  isStaff: true,
  isViewer: false,
  canSeeCosts: false,
  active: true,
} as const;

export function isApiBotEmail(email: string): boolean {
  return email === API_BOT_EMAIL;
}

export async function getApiBotUser() {
  return db.user.findUnique({ where: { email: API_BOT_EMAIL } });
}

/** Create the bot user if missing; otherwise re-lock its flags (role,
 * canSeeCosts, no password, active) so the row always matches API_BOT_FLAGS. */
export async function ensureApiBotUser(): Promise<{ id: string; created: boolean }> {
  const existing = await getApiBotUser();
  if (existing) {
    const drifted =
      existing.name !== API_BOT_NAME ||
      existing.passwordHash !== null ||
      existing.isAdmin !== API_BOT_FLAGS.isAdmin ||
      existing.isApprover !== API_BOT_FLAGS.isApprover ||
      existing.isStaff !== API_BOT_FLAGS.isStaff ||
      existing.isViewer !== API_BOT_FLAGS.isViewer ||
      existing.canSeeCosts !== API_BOT_FLAGS.canSeeCosts ||
      existing.active !== API_BOT_FLAGS.active;
    if (drifted) {
      await db.user.update({
        where: { id: existing.id },
        data: { name: API_BOT_NAME, passwordHash: null, ...API_BOT_FLAGS },
      });
    }
    return { id: existing.id, created: false };
  }
  const user = await db.user.create({
    data: { email: API_BOT_EMAIL, name: API_BOT_NAME, passwordHash: null, ...API_BOT_FLAGS },
  });
  return { id: user.id, created: true };
}
