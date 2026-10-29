"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { getSettingsSnapshot } from "@/lib/settings";
import { addContact, makeMainContact, ownerOf, setContactActive, updateContact, type ContactOwner } from "@/lib/services/contacts";
import { contactSchema } from "@/lib/validation/companies";
import { bool, formValues, str, zodFieldErrors, type FormState } from "@/lib/validation/forms";

const ownerPath = (o: ContactOwner) => `/${o.kind === "customer" ? "customers" : "suppliers"}/${o.id}`;

function revalidateOwner(o: ContactOwner) {
  revalidatePath(ownerPath(o));
}

async function parse(form: FormData) {
  const { settings } = await getSettingsSnapshot();
  return contactSchema(settings.lists.contactRoles).safeParse({
    name: str(form, "name"),
    role: str(form, "role"),
    email: str(form, "email"),
    phone: str(form, "phone"),
    isMain: bool(form, "isMain"),
  });
}

export async function addContactAction(owner: ContactOwner, _prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  let done = false;
  const result = await runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const parsed = await parse(form);
    if (!parsed.success) return { values, fieldErrors: zodFieldErrors(parsed.error) };
    await addContact(owner, parsed.data, user.id);
    revalidateOwner(owner);
    done = true;
    return { ok: true };
  }, values);
  if (done) redirect(`${ownerPath(owner)}?tab=contacts`);
  return result;
}

export async function updateContactAction(id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const parsed = await parse(form);
    if (!parsed.success) return { values, fieldErrors: zodFieldErrors(parsed.error) };
    const saved = await updateContact(id, parsed.data, user.id);
    revalidateOwner(ownerOf(saved));
    revalidatePath(`/contacts/${id}`);
    return { ok: true, message: "Saved." };
  }, values);
}

export async function makeMainAction(id: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const saved = await makeMainContact(id, user.id);
    revalidateOwner(ownerOf(saved));
    revalidatePath(`/contacts/${id}`);
    return { ok: true };
  });
}

export async function setContactActiveAction(id: string, active: boolean): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const saved = await setContactActive(id, active, user.id);
    revalidateOwner(ownerOf(saved));
    revalidatePath(`/contacts/${id}`);
    return { ok: true };
  });
}
