"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { ROLES, type Role } from "@/lib/permissions";
import { saveSettings } from "@/lib/settings";
import { settingsValueFromForm } from "@/lib/settings/form";
import { isSettingsKey } from "@/lib/settings/schema";
import { saveWithholdingRates } from "@/lib/services/withholding";
import { createUser, resendInvite, setUserActive, updateUser, userSchema } from "@/lib/services/users";
import { createApiKey, revokeApiKey } from "@/lib/api/keys-admin";
import { ApiError } from "@/lib/api/errors";
import { bool, formValues, str, zodFieldErrors, type FormState } from "@/lib/validation/forms";
import { saveUserSignature, SignatureError } from "@/lib/services/user-signature";

export async function saveSettingsAction(key: string, _prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  return runAction(async () => {
    const user = await requireActionPermission("manage_settings");
    if (!isSettingsKey(key)) return { message: "Unknown setting." };
    const baseVersionId = str(form, "baseVersionId");
    const value = settingsValueFromForm(key, (name) => {
      const all = form.getAll(name);
      const last = all[all.length - 1];
      return typeof last === "string" ? last : null;
    });
    const result = await saveSettings({ key, value, userId: user.id, baseVersionId });
    if (!result.ok) return { values, fieldErrors: result.fieldErrors, message: "Fix the fields marked below." };
    revalidatePath("/", "layout");
    return { ok: true, message: result.changed ? `Saved as version ${result.version.version}. New documents use it from now on.` : "Nothing changed." };
  }, values);
}

/** Saves company letterhead + print options (and optional logo upload) as sequential settings versions. */
export async function savePrintCompanyAction(_prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  return runAction(async () => {
    const user = await requireActionPermission("manage_settings");
    let baseVersionId = str(form, "baseVersionId");
    const get = (name: string) => {
      const all = form.getAll(name);
      const last = all[all.length - 1];
      return typeof last === "string" ? last : null;
    };

    let logoStorageKey = get("logoStorageKey") ?? "";
    const logo = form.get("logo");
    if (logo && typeof logo !== "string" && "arrayBuffer" in logo && logo.size > 0) {
      const { sniffLogoMime } = await import("@/lib/print/logo-sniff");
      const { newStorageKey, saveFile, discardUnreferencedFile } = await import("@/lib/business-docs/storage");
      const { uploadMaxBytes } = await import("@/lib/business-docs/sniff");
      const bytes = new Uint8Array(await logo.arrayBuffer());
      if (bytes.byteLength > uploadMaxBytes()) {
        return { values, fieldErrors: { logo: `The file is too big. The limit is ${Math.round(uploadMaxBytes() / 1024 / 1024)} MB.` }, message: "Fix the fields marked below." };
      }
      if (!sniffLogoMime(bytes.subarray(0, 16))) {
        return { values, fieldErrors: { logo: "Upload a PNG, JPEG or WebP logo." }, message: "Fix the fields marked below." };
      }
      const key = newStorageKey();
      try {
        await saveFile(key, bytes);
        logoStorageKey = key;
      } catch (err) {
        await discardUnreferencedFile(key);
        throw err;
      }
    }

    const companyValue = {
      ...(settingsValueFromForm("company", get) as Record<string, unknown>),
      logoStorageKey,
    };
    const companyResult = await saveSettings({ key: "company", value: companyValue, userId: user.id, baseVersionId });
    if (!companyResult.ok) return { values, fieldErrors: companyResult.fieldErrors, message: "Fix the fields marked below." };
    baseVersionId = companyResult.version.id;

    const printValue = settingsValueFromForm("print", get);
    const printResult = await saveSettings({ key: "print", value: printValue, userId: user.id, baseVersionId });
    if (!printResult.ok) return { values, fieldErrors: printResult.fieldErrors, message: "Fix the fields marked below." };

    revalidatePath("/", "layout");
    const changed = companyResult.changed || printResult.changed;
    return {
      ok: true,
      message: changed
        ? `Saved as version ${printResult.version.version}. New documents use it from now on.`
        : "Nothing changed.",
    };
  }, values);
}

export async function saveWithholdingAction(_prev: FormState, form: FormData): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("manage_settings");
    let rows: unknown;
    try {
      rows = JSON.parse(str(form, "rows"));
    } catch {
      return { message: "Couldn't read the table. Reload the page and try again." };
    }
    const result = await saveWithholdingRates(rows, user.id, str(form, "baseVersionId"));
    if (!result.ok) return { fieldErrors: result.fieldErrors, message: result.fieldErrors._ ?? "Fix the rows marked below." };
    revalidatePath("/settings");
    return { ok: true, message: result.changed ? `Saved as version ${result.version}. New quotes use these rates from now on.` : "Nothing changed." };
  });
}

/** S-70: optional signature image from the user form. Returns a field error, if any. */
async function maybeSaveSignature(userId: string, form: FormData, actorId: string): Promise<string | null> {
  const file = form.get("signature");
  if (!(file instanceof File) || file.size === 0) return null;
  try {
    await saveUserSignature(userId, { name: file.name, size: file.size, bytes: new Uint8Array(await file.arrayBuffer()) }, actorId);
    return null;
  } catch (e) {
    return e instanceof SignatureError ? e.message : "Couldn't save the signature image. Try again.";
  }
}

function userInput(form: FormData) {
  return userSchema.safeParse({
    name: str(form, "name"),
    email: str(form, "email"),
    roles: form.getAll("roles").filter((r): r is Role => typeof r === "string" && (ROLES as string[]).includes(r)),
    position: str(form, "position") || undefined,
    canSeeCosts: bool(form, "canSeeCosts"),
  });
}

export async function createUserAction(_prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  let createdId: string | null = null;
  const result = await runAction(async () => {
    const actor = await requireActionPermission("manage_users");
    const parsed = userInput(form);
    if (!parsed.success) return { values, fieldErrors: zodFieldErrors(parsed.error) };
    const user = await createUser(parsed.data, actor.id);
    createdId = user.id;
    const sigErr = await maybeSaveSignature(user.id, form, actor.id);
    if (sigErr) return { values, fieldErrors: { signature: sigErr } };
    revalidatePath("/settings");
    return { ok: true };
  }, values);
  if (createdId) redirect(`/settings/users/${createdId}?invited=1`);
  return result;
}

export async function updateUserAction(id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  return runAction(async () => {
    const actor = await requireActionPermission("manage_users");
    const parsed = userInput(form);
    if (!parsed.success) return { values, fieldErrors: zodFieldErrors(parsed.error) };
    await updateUser(id, parsed.data, actor.id);
    const sigErr = await maybeSaveSignature(id, form, actor.id);
    if (sigErr) return { values, fieldErrors: { signature: sigErr } };
    revalidatePath("/settings");
    revalidatePath(`/settings/users/${id}`);
    return { ok: true, message: "Saved." };
  }, values);
}

export async function setUserActiveAction(id: string, active: boolean): Promise<FormState> {
  return runAction(async () => {
    const actor = await requireActionPermission("manage_users");
    await setUserActive(id, active, actor.id);
    revalidatePath("/settings");
    revalidatePath(`/settings/users/${id}`);
    return { ok: true };
  });
}

/** S-58: Admin clears a user's two-step secret (lost authenticator). The user re-enrolls from Two-step sign-in. */
export async function resetTwoFactorAction(id: string): Promise<FormState> {
  return runAction(async () => {
    await requireActionPermission("manage_users");
    await db.user.update({ where: { id }, data: { totpSecret: null } });
    revalidatePath("/settings");
    revalidatePath(`/settings/users/${id}`);
    return { ok: true, message: "Two-step sign-in reset. The user can enroll again." };
  });
}

/** S-58: Admin records that user access was reviewed today (who can sign in, and with which roles). */
export async function markAccessReviewedAction(): Promise<FormState> {
  return runAction(async () => {
    const actor = await requireActionPermission("manage_settings");
    await db.accessReview.create({ data: { reviewedById: actor.id } });
    revalidatePath("/settings");
    return { ok: true, message: "Access review recorded for today." };
  });
}

export async function resendInviteAction(id: string): Promise<FormState> {
  return runAction(async () => {
    await requireActionPermission("manage_users");
    await resendInvite(id);
    return { ok: true, message: "Invite sent." };
  });
}

export type CreateApiKeyState = FormState & { token?: string; keyPrefix?: string };

const EXPIRY_DAYS: Record<string, number | null> = {
  none: null,
  "30": 30,
  "90": 90,
  "365": 365,
};

/** REQ-API-001 PR-B: create a /api/v1 key. The raw key is returned once, in this response only. */
export async function createApiKeyAction(_prev: CreateApiKeyState, form: FormData): Promise<CreateApiKeyState> {
  const values = formValues(form);
  try {
    return await runAction(async () => {
      const user = await requireActionPermission("manage_settings");
      const days = EXPIRY_DAYS[str(form, "expiry")] ?? null;
      const expiresAt = days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;
      try {
        const made = await createApiKey({
          name: str(form, "name"),
          scopes: form.getAll("scopes").filter((v): v is string => typeof v === "string"),
          expiresAt,
          actorId: user.id,
        });
        revalidatePath("/settings");
        return { ok: true, message: "API key created. Copy it now — it will not be shown again.", token: made.token, keyPrefix: made.keyPrefix };
      } catch (e) {
        if (e instanceof ApiError) return { values, message: e.message };
        throw e;
      }
    }, values);
  } catch (e) {
    if (e instanceof ApiError) return { values, message: e.message };
    throw e;
  }
}

/** REQ-API-001 PR-B: revoke a /api/v1 key (immediate; the row is kept, never deleted). */
export async function revokeApiKeyAction(id: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("manage_settings");
    await revokeApiKey({ id, actorId: user.id });
    revalidatePath("/settings");
    return { ok: true, message: "API key revoked. It stops working immediately." };
  });
}
