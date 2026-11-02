"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { getSettingsSnapshot } from "@/lib/settings";
import { duplicateCustomer, saveCustomer, setCustomerActive } from "@/lib/services/companies";
import { saveAddress } from "@/lib/services/addresses";
import { listWithholdingRates } from "@/lib/services/withholding";
import { resolveCustomerSavedPick } from "@/lib/quotes/withholding-defaults";
import { customerSchema } from "@/lib/validation/companies";
import { addressSchema } from "@/lib/validation/addresses";
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
    const parsed = customerSchema(settings.lists.paymentTerms, activeCodes).safeParse({
      name: str(form, "name"),
      tin: str(form, "tin"),
      withholdingType: type,
      defaultWithholding: pick,
      defaultTerms: str(form, "defaultTerms"),
      notes: str(form, "notes"),
    });

    const street = str(form, "street");
    const barangay = str(form, "barangay");
    const cityMunicipality = str(form, "cityMunicipality");
    const province = str(form, "province");
    const zip = str(form, "zip");
    const isBilling = form.get("isBilling") !== null ? bool(form, "isBilling") : true;
    const sameAsBilling = form.get("sameAsBilling") !== null ? bool(form, "sameAsBilling") : true;
    const isDelivery = form.get("isDelivery") !== null ? bool(form, "isDelivery") : true;

    const deliveryStreet = str(form, "deliveryStreet");
    const deliveryBarangay = str(form, "deliveryBarangay");
    const deliveryCityMunicipality = str(form, "deliveryCityMunicipality");
    const deliveryProvince = str(form, "deliveryProvince");
    const deliveryZip = str(form, "deliveryZip");

    const fieldErrors: Record<string, string> = {};
    if (!parsed.success) {
      Object.assign(fieldErrors, zodFieldErrors(parsed.error));
    }

    if (street) {
      const parsedBilling = addressSchema.safeParse({
        kind: "BILLING",
        label: null,
        street,
        barangay,
        cityMunicipality,
        province,
        zip,
        isDefault: isBilling,
      });
      if (!parsedBilling.success) {
        Object.assign(fieldErrors, zodFieldErrors(parsedBilling.error));
      }
    }

    if (!sameAsBilling && deliveryStreet) {
      const parsedDelivery = addressSchema.safeParse({
        kind: "DELIVERY",
        label: null,
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
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      return {
        values: { ...values, defaultWithholding: pick == null ? "" : JSON.stringify(pick) },
        fieldErrors,
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

    if (street) {
      const owner = { kind: "customer" as const, id: saved.id };
      if (isBilling || sameAsBilling) {
        await saveAddress(
          null,
          owner,
          {
            kind: "BILLING",
            label: null,
            street,
            barangay,
            cityMunicipality,
            province,
            zip,
            isDefault: isBilling,
          },
          user.id,
        );
      }
      if (sameAsBilling) {
        await saveAddress(
          null,
          owner,
          {
            kind: "DELIVERY",
            label: null,
            street,
            barangay,
            cityMunicipality,
            province,
            zip,
            isDefault: true,
          },
          user.id,
        );
      } else if (deliveryStreet) {
        await saveAddress(
          null,
          owner,
          {
            kind: "DELIVERY",
            label: null,
            street: deliveryStreet,
            barangay: deliveryBarangay,
            cityMunicipality: deliveryCityMunicipality,
            province: deliveryProvince,
            zip: deliveryZip,
            isDefault: isDelivery,
          },
          user.id,
        );
      }
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
