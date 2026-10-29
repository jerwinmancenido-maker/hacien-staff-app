"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { getSettingsSnapshot } from "@/lib/settings";
import { saveCustomer, setCustomerActive } from "@/lib/services/companies";
import { customerSchema } from "@/lib/validation/companies";
import { formValues, str, zodFieldErrors, type FormState } from "@/lib/validation/forms";

export async function saveCustomerAction(id: string | null, _prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  let createdId: string | null = null;
  const result = await runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const { settings } = await getSettingsSnapshot();
    const parsed = customerSchema(settings.lists.paymentTerms).safeParse({
      name: str(form, "name"),
      tin: str(form, "tin"),
      address: str(form, "address"),
      withholdingType: str(form, "withholdingType") || undefined,
      defaultTerms: str(form, "defaultTerms"),
      notes: str(form, "notes"),
    });
    if (!parsed.success) return { values, fieldErrors: zodFieldErrors(parsed.error) };
    const saved = await saveCustomer(id, parsed.data, user.id);
    if (!id) createdId = saved.id;
    revalidatePath("/customers");
    revalidatePath(`/customers/${saved.id}`);
    return { ok: true, message: "Saved." };
  }, values);
  if (createdId) redirect(`/customers/${createdId}`);
  return result;
}

export async function setCustomerActiveAction(id: string, active: boolean): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    await setCustomerActive(id, active, user.id);
    revalidatePath("/customers");
    revalidatePath(`/customers/${id}`);
    return { ok: true };
  });
}
