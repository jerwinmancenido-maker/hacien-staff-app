"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { itemSchema } from "@/lib/validation/items";
import { saveItem, setItemActive } from "@/lib/services/items";
import { formValues, str, zodFieldErrors, type FormState } from "@/lib/validation/forms";

const FIELDS = ["name", "brand", "model", "category", "sku", "unit", "kind", "details", "defaultUnitPrice"] as const;

export async function saveItemAction(id: string | null, _prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  let createdId: string | null = null;
  const result = await runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const input: Record<string, unknown> = Object.fromEntries(FIELDS.map((f) => [f, str(form, f)]));
    const parsed = itemSchema().safeParse(input);
    if (!parsed.success) return { values, fieldErrors: zodFieldErrors(parsed.error) };
    const saved = await saveItem(id, parsed.data, user.id);
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
