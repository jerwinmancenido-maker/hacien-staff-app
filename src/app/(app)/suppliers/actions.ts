"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, requireActionPermission, ForbiddenError } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { db } from "@/lib/db";
import { getSettingsSnapshot } from "@/lib/settings";
import { CompanyRuleError, revealSupplierBankAccount, saveSupplier, setSupplierActive } from "@/lib/services/companies";
import { supplierSchema } from "@/lib/validation/companies";
import { formValues, str, zodFieldErrors, type FormState } from "@/lib/validation/forms";

const FIELDS = ["name", "tin", "defaultTerms", "bankAccountName", "bankAccountNumber", "bankBranch", "bankNotes", "notes"] as const;
const BANK_FIELDS = ["bankAccountName", "bankAccountNumber", "bankBranch", "bankNotes"] as const;

export async function saveSupplierAction(id: string | null, _prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  let createdId: string | null = null;
  const result = await runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const { settings } = await getSettingsSnapshot();

    // Server action check, fail closed: non-Admin submissions that include bank fields are refused.
    const hasBankFieldsInForm = BANK_FIELDS.some((f) => form.has(f));
    if (!user.isAdmin && hasBankFieldsInForm) {
      throw new CompanyRuleError("Only an Admin can add or edit bank details.", "bankAccountNumber");
    }

    const input: Record<string, unknown> = Object.fromEntries(FIELDS.map((f) => [f, str(form, f)]));
    input.taxType = str(form, "taxType") || undefined;

    // Non-Admin saving other supplier fields must NOT wipe bank fields
    if (!user.isAdmin && id) {
      const existing = await db.supplier.findUnique({ where: { id } });
      if (existing) {
        input.bankAccountName = existing.bankAccountName ?? "";
        input.bankAccountNumber = existing.bankAccountNumber ?? "";
        input.bankBranch = existing.bankBranch ?? "";
        input.bankNotes = existing.bankNotes ?? "";
      }
    }

    const parsed = supplierSchema(settings.lists.paymentTerms).safeParse(input);
    if (!parsed.success) return { values, fieldErrors: zodFieldErrors(parsed.error) };
    const saved = await saveSupplier(id, parsed.data, { id: user.id, isAdmin: user.isAdmin });
    if (!id) createdId = saved.id;
    revalidatePath("/suppliers");
    revalidatePath(`/suppliers/${saved.id}`);
    return { ok: true, message: "Saved." };
  }, values);
  if (createdId) redirect(`/suppliers/${createdId}`);
  return result;
}

export async function revealSupplierBankAccountAction(
  supplierId: string,
): Promise<{ ok: boolean; bankAccountNumber?: string; message?: string }> {
  try {
    const user = await getCurrentUser();
    if (!user || !user.active || !user.isAdmin) {
      throw new ForbiddenError();
    }
    const bankAccountNumber = await revealSupplierBankAccount(supplierId, user);
    return { ok: true, bankAccountNumber };
  } catch (e) {
    if (e instanceof ForbiddenError || e instanceof CompanyRuleError) {
      return { ok: false, message: e.message };
    }
    throw e;
  }
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
