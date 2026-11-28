"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { itemSchema } from "@/lib/validation/items";
import { saveItem, setItemActive } from "@/lib/services/items";
import { db } from "@/lib/db";
import { duplicateWarningMessage, findDuplicateNames } from "@/lib/duplicates";
import { formValues, str, zodFieldErrors, type FormState } from "@/lib/validation/forms";

const FIELDS = ["name", "brand", "model", "category", "sku", "unit", "kind", "details", "defaultUnitPrice", "updatedAt"] as const;

export async function saveItemAction(id: string | null, _prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  let createdId: string | null = null;
  const result = await runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const input: Record<string, unknown> = Object.fromEntries(FIELDS.map((f) => [f, str(form, f)]));
    // F36: the stale-edit token is sent only on edits. On create it must be
    // undefined — "" fails the schema's datetime check, which silently
    // blocked every item creation (mirrors the customers action).
    if (!input.updatedAt) input.updatedAt = undefined;
    const parsed = itemSchema().safeParse(input);
    if (!parsed.success) return { values, fieldErrors: zodFieldErrors(parsed.error) };
    // Finding 1364: near-duplicate name warning (create only) — the shared
    // matcher (lib/duplicates); confirmed matches are audit-noted by the
    // service on the create row.
    const dupes = !id ? await findDuplicateNames(db, "item", parsed.data.name) : [];
    if (dupes.length && str(form, "confirmDuplicateName") !== "1") {
      return { values, warning: duplicateWarningMessage("item", dupes) };
    }
    const saved = await saveItem(id, parsed.data, user.id, {
      duplicateNameWarningConfirmed: dupes,
    });
    if (!id) createdId = saved.id;
    revalidatePath("/items");
    revalidatePath(`/items/${saved.id}`);
    return { ok: true, message: "Saved." };
  }, values);
  if (createdId) redirect(`/items/${createdId}`);
  return result;
}

export async function setItemActiveAction(id: string, active: boolean): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    await setItemActive(id, active, user.id);
    revalidatePath("/items");
    revalidatePath(`/items/${id}`);
    return { ok: true };
  });
}
