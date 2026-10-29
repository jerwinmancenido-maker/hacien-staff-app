import type { TokenPurpose, User } from "@prisma/client";
import { z } from "zod";
import { db, isUniqueViolation, type Tx } from "../db";
import { writeAudit } from "../audit";
import { appUrl, getMailer } from "../mailer";
import { hashPassword } from "../auth/password";
import { hashToken, randomToken } from "../auth/tokens";
import { lastRoleGuard, roleFlags, ROLES, type Role } from "../permissions";

export const userSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  email: z.email("Enter a valid email.").trim().toLowerCase().max(191),
  roles: z.array(z.enum(ROLES as [Role, ...Role[]])).min(1, "Pick at least one role."),
  canSeeCosts: z.boolean(),
});
export type UserInput = z.infer<typeof userSchema>;

const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  RESET: 60 * 60 * 1000, // 1 hour
  INVITE: 7 * 24 * 60 * 60 * 1000, // 7 days
};

export class UserRuleError extends Error {}

export const DUPLICATE_EMAIL = "A user with this email already exists.";

/** Public fields safe to put in an audit diff. */
function auditable(u: User) {
  const { passwordHash: _p, ...rest } = u;
  void _p;
  return rest;
}

/** Lock all user rows so the last-admin/approver check can't race. */
async function lockUsers(tx: Tx) {
  await tx.$queryRaw`SELECT id FROM \`User\` FOR UPDATE`;
  return tx.user.findMany({ select: { id: true, active: true, isAdmin: true, isApprover: true, isStaff: true, isViewer: true } });
}

/** New single-use link. Older unused links of the same kind for this user stop working. */
export async function issueToken(tx: Tx, userId: string, purpose: TokenPurpose, now = new Date()): Promise<string> {
  const token = randomToken();
  // Marked used (never deleted) so only the newest link works.
  await tx.passwordResetToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: now } });
  await tx.passwordResetToken.create({
    data: { userId, purpose, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + TOKEN_TTL_MS[purpose]) },
  });
  return token;
}

async function sendInvite(email: string, name: string, token: string) {
  await getMailer().send({
    to: email,
    subject: "You're invited to the HACIEN staff app",
    text: `Hi ${name},\n\nAn account was made for you in the HACIEN staff app.\nSet your password here (link works for 7 days):\n\n${appUrl(`/reset-password?token=${token}`)}\n`,
  });
}

export async function createUser(input: UserInput, actorId: string) {
  let created: { user: User; token: string };
  try {
    created = await db.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: input.email } });
      if (existing) throw new UserRuleError(DUPLICATE_EMAIL);
      const user = await tx.user.create({
        data: { name: input.name, email: input.email, canSeeCosts: input.canSeeCosts, ...roleFlags(input.roles) },
      });
      await writeAudit(tx, { userId: actorId, entityType: "User", entityId: user.id, action: "create", after: auditable(user) });
      const token = await issueToken(tx, user.id, "INVITE");
      return { user, token };
    });
  } catch (e) {
    // Two admins adding the same email at once: the unique index catches the second.
    if (isUniqueViolation(e)) throw new UserRuleError(DUPLICATE_EMAIL);
    throw e;
  }
  const { user, token } = created;
  await sendInvite(user.email, user.name, token);
  return user;
}

export async function resendInvite(userId: string) {
  const token = await db.$transaction((tx) => issueToken(tx, userId, "INVITE"));
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  await sendInvite(user.email, user.name, token);
}

export async function updateUser(id: string, input: UserInput, actorId: string) {
  try {
    return await db.$transaction(async (tx) => {
      const all = await lockUsers(tx);
      const before = await tx.user.findUniqueOrThrow({ where: { id } });
      const flags = roleFlags(input.roles);
      const err = lastRoleGuard(all, id, { active: before.active, ...flags });
      if (err) throw new UserRuleError(err);
      const clash = await tx.user.findFirst({ where: { email: input.email, NOT: { id } } });
      if (clash) throw new UserRuleError(DUPLICATE_EMAIL);
      const after = await tx.user.update({
        where: { id },
        data: { name: input.name, email: input.email, canSeeCosts: input.canSeeCosts, ...flags },
      });
      await writeAudit(tx, { userId: actorId, entityType: "User", entityId: id, action: "update", before: auditable(before), after: auditable(after) });
      return after;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new UserRuleError(DUPLICATE_EMAIL);
    throw e;
  }
}

/** Turn off (blocks login, revokes sessions) or turn back on. Never deletes. */
export async function setUserActive(id: string, active: boolean, actorId: string) {
  return db.$transaction(async (tx) => {
    const all = await lockUsers(tx);
    const before = await tx.user.findUniqueOrThrow({ where: { id } });
    if (before.active === active) return before;
    const err = lastRoleGuard(all, id, { ...before, active });
    if (err) throw new UserRuleError(err);
    const after = await tx.user.update({
      where: { id },
      data: { active, archivedAt: active ? null : new Date() },
    });
    if (!active) {
      await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await writeAudit(tx, {
      userId: actorId,
      entityType: "User",
      entityId: id,
      action: active ? "restore" : "archive",
      before: auditable(before),
      after: auditable(after),
    });
    return after;
  });
}

/** Sends a reset link if the email belongs to an active user. Caller shows the same message either way. */
export async function requestPasswordReset(email: string) {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || !user.active) return;
  const token = await db.$transaction((tx) => issueToken(tx, user.id, "RESET"));
  await getMailer().send({
    to: user.email,
    subject: "Reset your HACIEN password",
    text: `Hi ${user.name},\n\nSomeone asked to reset your HACIEN staff app password.\nIf it was you, set a new one here (link works for 1 hour):\n\n${appUrl(`/reset-password?token=${token}`)}\n\nIf it wasn't you, ignore this email.\n`,
  });
}

/** Look up a usable token (not used, not expired, user active). */
export async function findValidToken(token: string) {
  if (!token) return null;
  const row = await db.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt < new Date() || !row.user.active) return null;
  return row;
}

export async function setPasswordWithToken(token: string, password: string): Promise<boolean> {
  const row = await findValidToken(token);
  if (!row) return false;
  const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    // Mark used first; the conditional update makes the token single-use under races.
    const used = await tx.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count !== 1) throw new UserRuleError("This link was already used.");
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
    // Changing the password signs out other sessions.
    await tx.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await writeAudit(tx, {
      userId: row.userId,
      entityType: "User",
      entityId: row.userId,
      action: "update",
      before: null,
      after: { password: row.purpose === "INVITE" ? "set from invite" : "reset" },
      diff: false,
    });
  });
  return true;
}
