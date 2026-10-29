"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { getSettingsSnapshot } from "@/lib/settings";
import { saveSupplier, setSupplierActive } from "@/lib/services/companies";
import { supplierSchema } from "@/lib/validation/companies";
import { formValues, str, zodFieldErrors, type FormState } from "@/lib/validation/forms";

const FIELDS = ["name", "tin", "address", "defaultTerms", "bankAccountName", "bankAccountNumber", "bankBranch", "bankNotes", "notes"] as const;

export async function saveSupplierAction(id: string | null, _prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  let createdId: string | null = null;
  const result = await runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const { settings } = await getSettingsSnapshot();
    const input: Record<string, unknown> = Object.fromEntries(FIELDS.map((f) => [f, str(form, f)]));
    input.taxType = str(form, "taxType") || undefined;
    const parsed = supplierSchema(settings.lists.paymentTerms).safeParse(input);
    if (!parsed.success) return { values, fieldErrors: zodFieldErrors(parsed.error) };
    const saved = await saveSupplier(id, parsed.data, user.id);
    if (!id) createdId = saved.id;
    revalidatePath("/suppliers");
    revalidatePath(`/suppliers/${saved.id}`);
    return { ok: true, message: "Saved." };
  }, values);
  if (createdId) redirect(`/suppliers/${createdId}`);
  return result;
}

export async function setSupplierActiveAction(id: string, active: boolean): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    await setSupplierActive(id, active, user.id);
    revalidatePath("/suppliers");
    revalidatePath(`/suppliers/${id}`);
    return { ok: true };
  });
}
