"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, requireActionPermission, requestMeta, ForbiddenError } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { db } from "@/lib/db";
import { getSettingsSnapshot } from "@/lib/settings";
import { CompanyRuleError, revealSupplierBankAccount, saveSupplier, setSupplierActive } from "@/lib/services/companies";
import { addContact } from "@/lib/services/contacts";
import { z } from "zod";
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

    let allowedTerms = settings.lists.paymentTerms;
    if (id) {
      const existing = await db.supplier.findUnique({ where: { id } });
      if (existing) {
        if (!user.isAdmin) {
          input.bankAccountName = existing.bankAccountName ?? "";
          input.bankAccountNumber = existing.bankAccountNumber ?? "";
          input.bankBranch = existing.bankBranch ?? "";
          input.bankNotes = existing.bankNotes ?? "";
        }
        const current = existing.defaultTerms?.trim() ?? "";
        if (current && !allowedTerms.includes(current)) allowedTerms = [...allowedTerms, current];
      }
    }

    const parsed = supplierSchema(allowedTerms).safeParse(input);
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

export type CreatedInlineSupplier = {
  id: string;
  name: string;
  defaultTerms: string | null;
  address: string | null;
  contacts: { id: string; name: string; isMain: boolean }[];
};
export type CreateInlineSupplierState = FormState & { supplier?: CreatedInlineSupplier };

/** Optional first contact for the inline drawer: if any contact field is
 * filled, a name plus an email or a phone is required (same rule as the
 * quote editor's customer drawer). */
const inlineContactSchema = z
  .object({
    contactName: z.string().trim().max(191),
    contactEmail: z
      .string()
      .trim()
      .max(191)
      .refine((v) => !v || z.string().email().safeParse(v).success, "Enter a valid email."),
    contactPhone: z.string().trim().max(64),
  })
  .superRefine((v, ctx) => {
    if ((v.contactEmail || v.contactPhone) && !v.contactName) {
      ctx.addIssue({ code: "custom", path: ["contactName"], message: "Contact name is required when adding a contact." });
    }
    if (v.contactName && !v.contactEmail && !v.contactPhone) {
      ctx.addIssue({ code: "custom", path: ["contactEmail"], message: "Add an email or a phone number." });
    }
  });

/** Inline "Add supplier" from the PO editor: the same validation and
 * saveSupplier service as the suppliers page, but it returns the created
 * supplier instead of redirecting, so the editor keeps its unsaved state and
 * can select the new supplier right away. Bank details are NOT accepted
 * here — they stay on the supplier record (Admin-only, fail closed there). */
export async function createInlineSupplierAction(_prev: CreateInlineSupplierState, form: FormData): Promise<CreateInlineSupplierState> {
  const values = formValues(form);
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const { settings } = await getSettingsSnapshot();
    const parsed = supplierSchema(settings.lists.paymentTerms).safeParse({
      name: str(form, "name"),
      tin: str(form, "tin"),
      taxType: str(form, "taxType") || undefined,
      defaultTerms: str(form, "defaultTerms"),
      bankAccountName: "",
      bankAccountNumber: "",
      bankBranch: "",
      bankNotes: "",
      notes: "",
    });
    if (!parsed.success) return { values, fieldErrors: zodFieldErrors(parsed.error) };
    const contactParsed = inlineContactSchema.safeParse({
      contactName: str(form, "contactName"),
      contactEmail: str(form, "contactEmail"),
      contactPhone: str(form, "contactPhone"),
    });
    if (!contactParsed.success) return { values, fieldErrors: zodFieldErrors(contactParsed.error) };
    const saved = await saveSupplier(null, parsed.data, { id: user.id, isAdmin: user.isAdmin });
    let contacts: CreatedInlineSupplier["contacts"] = [];
    if (contactParsed.data.contactName) {
      const created = await addContact(
        { kind: "supplier", id: saved.id },
        {
          name: contactParsed.data.contactName,
          role: null,
          email: contactParsed.data.contactEmail ? contactParsed.data.contactEmail.toLowerCase() : null,
          phone: contactParsed.data.contactPhone || null,
          isMain: true,
          marketingEmailConsent: false,
          marketingSmsConsent: false,
        },
        user.id,
        await requestMeta(),
      );
      contacts = [{ id: created.id, name: created.name, isMain: created.isMain }];
    }
    revalidatePath("/suppliers");
    return {
      ok: true,
      supplier: { id: saved.id, name: saved.name, defaultTerms: saved.defaultTerms, address: null, contacts },
    };
  }, values);
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
