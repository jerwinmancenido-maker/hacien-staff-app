"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { getSettingsSnapshot } from "@/lib/settings";
import { duplicateCustomer, getCustomer, saveCustomer, setCustomerActive } from "@/lib/services/companies";
import { saveAddress } from "@/lib/services/addresses";
import { listWithholdingRates } from "@/lib/services/withholding";
import { resolveCustomerSavedPick } from "@/lib/quotes/withholding-defaults";
import { customerSchema } from "@/lib/validation/companies";
import { addressSchema, type AddressInput } from "@/lib/validation/addresses";
import { bool, formValues, str, zodFieldErrors, type FormState } from "@/lib/validation/forms";

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
    const type = str(form, "withholdingType") || undefined;
    // "No" always saves explicit none []; Yes shows the pick boxes.
    // Blank / not-set stays null and is rejected by the schema (never coerced to []).
    const pick = resolveCustomerSavedPick(type, parsePickFromForm(form));
    // A customer saved before terms were required can still be edited with blank terms.
    // A term already on the record stays valid even if it later leaves the Settings list.
    let allowedTerms = settings.lists.paymentTerms;
    let termsRequired = true;
    if (id) {
      const existing = await getCustomer(id);
      const current = existing?.defaultTerms?.trim() ?? "";
      if (current && !allowedTerms.includes(current)) allowedTerms = [...allowedTerms, current];
      if (!current) termsRequired = false;
    }
    const parsed = customerSchema(allowedTerms, activeCodes, termsRequired).safeParse({
      name: str(form, "name"),
      tin: str(form, "tin"),
      withholdingType: type,
      defaultWithholding: pick,
      defaultTerms: str(form, "defaultTerms"),
      creditLimit: str(form, "creditLimit"),
      notes: str(form, "notes"),
      // Checkbox: absent = unchecked = off. Present (checked) = on.
      orderTextUpdates: bool(form, "orderTextUpdates"),
    });

    const street = str(form, "street");
    const barangay = str(form, "barangay");
    const cityMunicipality = str(form, "cityMunicipality");
    const province = str(form, "province");
    const zip = str(form, "zip");
    // Unchecked boxes are omitted from FormData. The form sends explicit true/false.
    // Missing (older posts) still means "this is the default billing and delivery address".
    const isBilling = form.has("isBilling") ? bool(form, "isBilling") : true;
    const sameAsBilling = form.has("sameAsBilling") ? bool(form, "sameAsBilling") : true;
    const isDelivery = form.has("isDelivery") ? bool(form, "isDelivery") : true;

    const deliveryStreet = str(form, "deliveryStreet");
    const deliveryBarangay = str(form, "deliveryBarangay");
    const deliveryCityMunicipality = str(form, "deliveryCityMunicipality");
    const deliveryProvince = str(form, "deliveryProvince");
    const deliveryZip = str(form, "deliveryZip");

    const fieldErrors: Record<string, string> = {};
    if (!parsed.success) {
      Object.assign(fieldErrors, zodFieldErrors(parsed.error));
    }

    let billingData: AddressInput | null = null;
    let deliveryData: AddressInput | null = null;
    if (street.trim()) {
      const parsedBilling = addressSchema.safeParse({
        kind: "BILLING",
        label: "",
        street,
        barangay,
        cityMunicipality,
        province,
        zip,
        isDefault: isBilling,
      });
      if (!parsedBilling.success) {
        Object.assign(fieldErrors, zodFieldErrors(parsedBilling.error));
      } else {
        billingData = parsedBilling.data;
      }
    }

    if (!sameAsBilling && deliveryStreet.trim()) {
      const parsedDelivery = addressSchema.safeParse({
        kind: "DELIVERY",
        label: "",
        street: deliveryStreet,
        barangay: deliveryBarangay,
        cityMunicipality: deliveryCityMunicipality,
        province: deliveryProvince,
        zip: deliveryZip,
        isDefault: isDelivery,
      });
      if (!parsedDelivery.success) {
        for (const [k, v] of Object.entries(zodFieldErrors(parsedDelivery.error))) {
          fieldErrors[`delivery${k.charAt(0).toUpperCase() + k.slice(1)}`] = v;
        }
      } else {
        deliveryData = parsedDelivery.data;
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      return {
        values: { ...values, defaultWithholding: pick == null ? "" : JSON.stringify(pick) },
        fieldErrors,
        message: "Fix the fields marked below.",
      };
    }

    if (!parsed.success) {
      return {
        values: { ...values, defaultWithholding: pick == null ? "" : JSON.stringify(pick) },
        fieldErrors: zodFieldErrors(parsed.error),
      };
    }

    let saved;
    try {
      saved = await saveCustomer(id, parsed.data, { id: user.id, isAdmin: user.isAdmin });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save.";
      if (/Only an Admin can change/i.test(msg)) {
        return {
          values: { ...values, defaultWithholding: pick == null ? "" : JSON.stringify(pick) },
          fieldErrors: { defaultWithholding: msg, withholdingType: msg },
          message: msg,
        };
      }
      throw err;
    }

    const owner = { kind: "customer" as const, id: saved.id };
    if (billingData) {
      await saveAddress(null, owner, billingData, user.id);
      if (sameAsBilling) {
        await saveAddress(null, owner, { ...billingData, kind: "DELIVERY", isDefault: true }, user.id);
      }
    }
    if (deliveryData) {
      await saveAddress(null, owner, deliveryData, user.id);
    }

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

export async function duplicateCustomerAction(id: string): Promise<FormState> {
  let createdId: string | null = null;
  const result = await runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const dup = await duplicateCustomer(id, { id: user.id, isAdmin: user.isAdmin });
    createdId = dup.id;
    revalidatePath("/customers");
    revalidatePath(`/customers/${dup.id}`);
    return { ok: true };
  });
  if (createdId) redirect(`/customers/${createdId}`);
  return result;
}
