"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActionPermission, requestMeta } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { getSettingsSnapshot } from "@/lib/settings";
import { addContact, makeMainContact, ownerOf, setContactActive, updateContact, type ContactOwner } from "@/lib/services/contacts";
import {
  clearEmailSuppression,
  completeEmailUnsubscribeRequest,
  ConsentError,
  recordEmailUnsubscribeRequest,
  type ConsentMeta,
} from "@/lib/marketing-consent";
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
    marketingEmailConsent: bool(form, "marketingEmailConsent"),
    marketingSmsConsent: bool(form, "marketingSmsConsent"),
  });
}

export async function addContactAction(owner: ContactOwner, _prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  let done = false;
  const result = await runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const parsed = await parse(form);
    if (!parsed.success) return { values, fieldErrors: zodFieldErrors(parsed.error) };
    await addContact(owner, parsed.data, user.id, await requestMeta());
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
    const saved = await updateContact(id, parsed.data, user.id, await requestMeta());
    revalidateOwner(ownerOf(saved));
    revalidatePath(`/contacts/${id}`);
    return { ok: true, message: "Saved." };
  }, values);
}

/** Staff records that a contact asked by email to stop marketing emails. Due in 3 business days. */
export async function recordEmailUnsubscribeRequestAction(id: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    await recordEmailUnsubscribeRequest(id, user.id);
    revalidatePath(`/contacts/${id}`);
    return { ok: true, message: "Email unsubscribe request recorded. Complete it within 3 business days." };
  });
}

/** Staff completes a pending email unsubscribe request: suppression + consent OFF. */
export async function completeEmailUnsubscribeRequestAction(id: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const meta: ConsentMeta = { ...(await requestMeta()), source: "staff-completed email request", changedBy: user.id };
    try {
      await completeEmailUnsubscribeRequest(id, meta);
    } catch (e) {
      if (!(e instanceof ConsentError)) throw e;
      return { message: e.message };
    }
    revalidatePath(`/contacts/${id}`);
    return { ok: true, message: "Done. The email is now on the do-not-email list." };
  });
}

/** Admin-only explicit clear of a do-not-email suppression. The row itself is never deleted. */
export async function clearEmailSuppressionAction(email: string, contactId: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("manage_settings");
    await clearEmailSuppression(email, user.id);
    revalidatePath(`/contacts/${contactId}`);
    return { ok: true, message: "Suppression cleared. The email can be opted in again." };
  });
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
