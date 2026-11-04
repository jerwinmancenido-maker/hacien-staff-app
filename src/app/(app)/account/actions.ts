"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { runAction } from "@/lib/actions";
import { getCurrentUser } from "@/lib/auth/current-user";
import { verifyPassword } from "@/lib/auth/password";
import { ForbiddenError } from "@/lib/permissions";
import { encryptTotpSecret, verifyTotpCode } from "@/lib/auth/totp";
import { str, type FormState } from "@/lib/validation/forms";

/** S-58: finish enrollment — the code must match the secret shown on the setup page. */
export async function setupTwoFactorAction(_prev: FormState, form: FormData): Promise<FormState> {
  return runAction(async () => {
    const user = await getCurrentUser();
    if (!user) throw new ForbiddenError();
    const secret = str(form, "secret").trim().toUpperCase();
    const code = str(form, "code").trim();
    if (!secret || !verifyTotpCode(secret, code)) {
      return { fieldErrors: { code: "That code does not match. Scan the QR again and enter the current code." } };
    }
    await db.user.update({ where: { id: user.id }, data: { totpSecret: encryptTotpSecret(secret) } });
    revalidatePath("/account/two-step");
    return { ok: true, message: "Two-step sign-in is on. Your next sign-in will ask for a code." };
  });
}

/** S-58: turn two-step off again (password confirmation, so a brief unlocked screen is not enough). */
export async function disableTwoFactorAction(_prev: FormState, form: FormData): Promise<FormState> {
  return runAction(async () => {
    const user = await getCurrentUser();
    if (!user) throw new ForbiddenError();
    const record = await db.user.findUnique({ where: { id: user.id } });
    if (!record || !(await verifyPassword(str(form, "password"), record.passwordHash))) {
      return { fieldErrors: { password: "That password is not right." } };
    }
    await db.user.update({ where: { id: user.id }, data: { totpSecret: null } });
    revalidatePath("/account/two-step");
    return { ok: true, message: "Two-step sign-in is off." };
  });
}
