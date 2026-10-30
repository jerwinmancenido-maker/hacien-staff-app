"use server";

import { revalidatePath } from "next/cache";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { uploadMaxBytes } from "@/lib/business-docs/sniff";
import { setBusinessDocumentArchived, uploadBusinessDocument, type DocOwner } from "@/lib/services/business-documents";
import { businessDocumentMetaSchema } from "@/lib/validation/business-documents";
import { formValues, str, zodFieldErrors, type FormState } from "@/lib/validation/forms";

const ownerPath = (o: { customerId?: string | null; supplierId?: string | null }) =>
  o.customerId ? `/customers/${o.customerId}` : `/suppliers/${o.supplierId}`;

export async function uploadBusinessDocumentAction(ownerKind: string, ownerId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    if (ownerKind !== "customer" && ownerKind !== "supplier") throw new Error("Bad owner kind.");
    const owner: DocOwner = { kind: ownerKind, id: ownerId };
    const parsed = businessDocumentMetaSchema.safeParse({
      type: str(form, "type") || undefined,
      otherLabel: str(form, "otherLabel"),
      docNumber: str(form, "docNumber"),
      issueDate: str(form, "issueDate"),
      expiryDate: str(form, "expiryDate"),
      replacesId: str(form, "replacesId"),
    });
    const file = form.get("file");
    const fieldErrors = parsed.success ? {} : zodFieldErrors(parsed.error);
    if (!(file instanceof File) || file.size === 0) fieldErrors.file = "Pick a PDF, JPG or PNG file.";
    else if (file.size > uploadMaxBytes()) fieldErrors.file = `The file is too big. The limit is ${Math.round(uploadMaxBytes() / 1024 / 1024)} MB.`;
    if (!parsed.success || Object.keys(fieldErrors).length) return { values, fieldErrors };
    const f = file as File;
    await uploadBusinessDocument(owner, parsed.data, { name: f.name, size: f.size, bytes: new Uint8Array(await f.arrayBuffer()) }, user);
    revalidatePath(ownerPath(owner.kind === "customer" ? { customerId: owner.id } : { supplierId: owner.id }));
    return { ok: true, message: parsed.data.replacesId ? "Uploaded. The old file is archived." : "Uploaded." };
  }, values);
}

export async function setBusinessDocumentArchivedAction(id: string, archived: boolean): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const doc = await setBusinessDocumentArchived(id, archived, user);
    revalidatePath(ownerPath(doc));
    return { ok: true };
  });
}
