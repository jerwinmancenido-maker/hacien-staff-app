"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { getSettingsSnapshot } from "@/lib/settings";
import { saveCustomer, setCustomerActive } from "@/lib/services/companies";
import { listWithholdingRates } from "@/lib/services/withholding";
import { customerSchema } from "@/lib/validation/companies";
import { formValues, str, zodFieldErrors, type FormState } from "@/lib/validation/forms";

function parsePickFromForm(form: FormData): string[] | null {
  const raw = str(form, "defaultWithholdingJson");
  if (raw === "") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return null;
  }
}

export async function saveCustomerAction(id: string | null, _prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  let createdId: string | null = null;
  const result = await runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const { settings } = await getSettingsSnapshot();
    const activeCodes = (await listWithholdingRates(undefined, { activeOnly: true })).map((r) => r.code);
    const pick = parsePickFromForm(form);
    const parsed = customerSchema(settings.lists.paymentTerms, activeCodes).safeParse({
      name: str(form, "name"),
      tin: str(form, "tin"),
      withholdingType: str(form, "withholdingType") || undefined,
      defaultWithholding: pick,
      defaultTerms: str(form, "defaultTerms"),
      notes: str(form, "notes"),
    });
    if (!parsed.success) {
      return {
        values: { ...values, defaultWithholding: pick == null ? "" : JSON.stringify(pick) },
        fieldErrors: zodFieldErrors(parsed.error),
      };
    }
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
