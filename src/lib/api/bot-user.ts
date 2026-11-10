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
 * The account can never sign in: passwordHash stays null (the column is
 * null until a user sets a password from an invite, and no invite is ever
 * sent for this address).
 */
export const API_BOT_EMAIL = "api-bot@haciensolutions.com";
export const API_BOT_NAME = "API / Bot";

export async function getApiBotUser() {
  return db.user.findUnique({ where: { email: API_BOT_EMAIL } });
}

/** Create the bot user if it does not exist yet. Never updates an existing row. */
export async function ensureApiBotUser(): Promise<{ id: string; created: boolean }> {
  const existing = await getApiBotUser();
  if (existing) return { id: existing.id, created: false };
  const user = await db.user.create({
    data: {
      email: API_BOT_EMAIL,
      name: API_BOT_NAME,
      passwordHash: null,
      isAdmin: false,
      isApprover: false,
      isStaff: true,
      isViewer: false,
      canSeeCosts: false,
      active: true,
    },
  });
  return { id: user.id, created: true };
}
