"use server";

import { revalidatePath } from "next/cache";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { db } from "@/lib/db";
import { addressOwnerOf, makeDefaultAddress, saveAddress, setAddressArchived, type AddressOwner } from "@/lib/services/addresses";
import { addressSchema } from "@/lib/validation/addresses";
import { bool, formValues, str, zodFieldErrors, type FormState } from "@/lib/validation/forms";

const ownerPath = (o: AddressOwner) => `/${o.kind === "customer" ? "customers" : "suppliers"}/${o.id}`;

function owner(kind: string, id: string): AddressOwner {
  if (kind !== "customer" && kind !== "supplier") throw new Error("Bad owner kind.");
  return { kind, id };
}

export async function saveAddressAction(ownerKind: string, ownerId: string, id: string | null, _prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const o = owner(ownerKind, ownerId);
    const parsed = addressSchema.safeParse({
      kind: str(form, "kind") || undefined,
      label: str(form, "label"),
      street: str(form, "street"),
      barangay: str(form, "barangay"),
      cityMunicipality: str(form, "cityMunicipality"),
      province: str(form, "province"),
      zip: str(form, "zip"),
      isDefault: bool(form, "isDefault"),
    });
    if (!parsed.success) return { values, fieldErrors: zodFieldErrors(parsed.error) };
    await saveAddress(id, o, parsed.data, user.id);
    revalidatePath(ownerPath(o));
    return { ok: true, message: id ? "Address saved." : "Address added." };
  }, values);
}

async function pathOf(id: string) {
  const a = await db.address.findUniqueOrThrow({ where: { id }, select: { customerId: true, supplierId: true } });
  return ownerPath(addressOwnerOf(a));
}

export async function setAddressArchivedAction(id: string, archived: boolean): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    await setAddressArchived(id, archived, user.id);
    revalidatePath(await pathOf(id));
    return { ok: true };
  });
}

export async function makeDefaultAddressAction(id: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    await makeDefaultAddress(id, user.id);
    revalidatePath(await pathOf(id));
    return { ok: true };
  });
}
