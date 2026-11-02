"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { changePasswordSchema, newPasswordSchema, verifyPassword } from "@/lib/auth/password";
import { checkLoginRateLimit, TOO_MANY_TRIES } from "@/lib/auth/rate-limit";
import { createSession, currentTokenHash, destroyCurrentSession, idleRemainingMs as readIdleRemainingMs } from "@/lib/auth/session";
import { getCurrentUser, requestMeta } from "@/lib/auth/current-user";
import { UserRuleError, changePassword, requestPasswordReset, setPasswordWithToken } from "@/lib/services/users";
import { ACCOUNT_OFF, RESET_SENT, WRONG_CREDENTIALS } from "@/lib/auth/messages";
import { str, zodFieldErrors, type FormState } from "@/lib/validation/forms";

export async function signIn(_prev: FormState, form: FormData): Promise<FormState> {
  const email = str(form, "email").trim().toLowerCase();
  const password = str(form, "password");
  const values = { email };
  if (!email || !password) {
    return {
      values,
      fieldErrors: {
        ...(email ? {} : { email: "Enter your email." }),
        ...(password ? {} : { password: "Enter your password." }),
      },
    };
  }

  const { ip, userAgent } = await requestMeta();
  if (await checkLoginRateLimit(db, email, ip)) return { values, message: TOO_MANY_TRIES };

  const user = await db.user.findUnique({ where: { email } });
  const passwordOk = await verifyPassword(password, user?.passwordHash);

  const fail = async (reason: string) => {
    await db.$transaction(async (tx) => {
      await tx.loginAttempt.create({ data: { email, ip, success: false } });
      await writeAudit(tx, {
        userId: user?.id ?? null,
        entityType: "Session",
        entityId: user?.id ?? null,
        action: "login_failed",
        after: { email, reason },
        ip,
        diff: false,
      });
    });
  };

  if (!user || !passwordOk) {
    await fail("wrong credentials");
    return { values, message: WRONG_CREDENTIALS };
  }
  if (!user.active) {
    await fail("account turned off");
    return { values, message: ACCOUNT_OFF };
  }

  await db.$transaction(async (tx) => {
    await tx.loginAttempt.create({ data: { email, ip, success: true } });
    await writeAudit(tx, { userId: user.id, entityType: "Session", entityId: user.id, action: "login", ip, diff: false });
  });
  await createSession(user.id, { ip, userAgent });
  redirect("/");
}

export async function signOut() {
  await destroyCurrentSession();
  redirect("/login");
}

/** Idle check for an open tab. Does not extend the deadline. */
export async function idleRemainingMs(): Promise<number> {
  return readIdleRemainingMs();
}

export async function forgotPassword(_prev: FormState, form: FormData): Promise<FormState> {
  const email = str(form, "email").trim().toLowerCase();
  if (!email) return { fieldErrors: { email: "Enter your email." } };
  try {
    await requestPasswordReset(email);
  } catch (e) {
    // Don't reveal anything to the visitor; log for the admin.
    console.error("[forgot-password] could not send reset email", e);
  }
  return { ok: true, message: RESET_SENT };
}

export async function resetPassword(_prev: FormState, form: FormData): Promise<FormState> {
  const token = str(form, "token");
  const parsed = newPasswordSchema.safeParse({ password: str(form, "password"), confirm: str(form, "confirm") });
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error) };
  let ok = false;
  try {
    ok = await setPasswordWithToken(token, parsed.data.password);
  } catch {
    ok = false;
  }
  if (!ok) return { message: "This link has expired or was already used. Ask for a new one." };
  redirect("/login?reset=1");
}

export async function changePasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = changePasswordSchema.safeParse({
    current: str(form, "current"),
    password: str(form, "password"),
    confirm: str(form, "confirm"),
  });
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), message: "Fix the fields marked below." };
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { ip } = await requestMeta();
  const rateKey = `pwd:${user.email}`;
  if (await checkLoginRateLimit(db, rateKey, ip)) return { message: TOO_MANY_TRIES };

  try {
    await changePassword(user.id, parsed.data.current, parsed.data.password, await currentTokenHash());
  } catch (e) {
    if (e instanceof UserRuleError) {
      if (e.message === "That current password is wrong.") {
        await db.loginAttempt.create({ data: { email: rateKey, ip, success: false } });
      }
      return { message: e.message };
    }
    throw e;
  }
  await db.loginAttempt.create({ data: { email: rateKey, ip, success: true } });
  return { ok: true, message: "Password changed. Your other devices are signed out. This device stays signed in." };
}
