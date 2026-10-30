"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { ROLES, type Role } from "@/lib/permissions";
import { saveSettings } from "@/lib/settings";
import { settingsValueFromForm } from "@/lib/settings/form";
import { isSettingsKey } from "@/lib/settings/schema";
import { saveWithholdingRates } from "@/lib/services/withholding";
import { createUser, resendInvite, setUserActive, updateUser, userSchema } from "@/lib/services/users";
import { bool, formValues, str, zodFieldErrors, type FormState } from "@/lib/validation/forms";

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

function userInput(form: FormData) {
  return userSchema.safeParse({
    name: str(form, "name"),
    email: str(form, "email"),
    roles: form.getAll("roles").filter((r): r is Role => typeof r === "string" && (ROLES as string[]).includes(r)),
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

export async function resendInviteAction(id: string): Promise<FormState> {
  return runAction(async () => {
    await requireActionPermission("manage_users");
    await resendInvite(id);
    return { ok: true, message: "Invite sent." };
  });
}
