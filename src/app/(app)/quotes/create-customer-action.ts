"use server";

// Inline "Add new customer" from the quote editor. Saves through the existing
// customer + contact services, returns the new customer for the picker, and
// never redirects (quote form data must stay intact).

import { revalidatePath } from "next/cache";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { db } from "@/lib/db";
import { getSettingsSnapshot } from "@/lib/settings";
import { saveCustomer } from "@/lib/services/companies";
import { addContact } from "@/lib/services/contacts";
import { listWithholdingRates } from "@/lib/services/withholding";
import { parseWithholdingPick, resolveCustomerSavedPick } from "@/lib/quotes/withholding-defaults";
import { customerSchema, WITHHOLDING_TYPES } from "@/lib/validation/companies";
import { str, zodFieldErrors, type FormState } from "@/lib/validation/forms";
import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .transform((v) => (v ? v : null));

/** Looser contact fields for the quote dialog (role is free text / Position). */
const quoteDialogContactSchema = z
  .object({
    name: z.string().trim().max(191).transform((v) => (v ? v : null)),
    role: optionalText(100),
    emailOrPhone: optionalText(191),
  })
  .superRefine((v, ctx) => {
    if (!v.name && (v.role || v.emailOrPhone)) {
      ctx.addIssue({ code: "custom", path: ["contactName"], message: "Contact name is required when adding a contact." });
    }
    if (v.name && !v.emailOrPhone) {
      ctx.addIssue({ code: "custom", path: ["emailOrPhone"], message: "Add an email or a phone number." });
    }
  });

export type CreatedQuoteCustomer = {
  id: string;
  name: string;
  address: string | null;
  defaultTerms: string | null;
  withholdingType: string;
  /** null = not set, [] = none, [codes] = picks. */
  defaultWithholding: string[] | null;
  contacts: { id: string; name: string; isMain: boolean }[];
};

export type CreateCustomerForQuoteState = FormState & {
  customer?: CreatedQuoteCustomer;
};

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

export async function createCustomerForQuoteAction(
  _prev: CreateCustomerForQuoteState,
  form: FormData,
): Promise<CreateCustomerForQuoteState> {
  let customer: CreatedQuoteCustomer | undefined;
  const result = await runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const { settings } = await getSettingsSnapshot();
    const activeCodes = (await listWithholdingRates(undefined, { activeOnly: true })).map((r) => r.code);

    const name = str(form, "name");
    const tin = str(form, "tin");
    const withholdingType = str(form, "withholdingType");
    const address = str(form, "address");
    const contactName = str(form, "contactName");
    const contactRole = str(form, "contactRole");
    const emailOrPhone = str(form, "emailOrPhone");
    const pick = resolveCustomerSavedPick(withholdingType, parsePickFromForm(form));

    const parsedCustomer = customerSchema(settings.lists.paymentTerms, activeCodes).safeParse({
      name,
      tin,
      withholdingType: withholdingType || undefined,
      defaultWithholding: pick,
      defaultTerms: "",
      notes: "",
    });
    if (!parsedCustomer.success) {
      return { fieldErrors: zodFieldErrors(parsedCustomer.error), message: "Fix the fields marked below." };
    }
    if (!(WITHHOLDING_TYPES as readonly string[]).includes(parsedCustomer.data.withholdingType)) {
      return { fieldErrors: { withholdingType: "Pick a type." }, message: "Fix the fields marked below." };
    }

    const parsedContact = quoteDialogContactSchema.safeParse({
      name: contactName,
      role: contactRole,
      emailOrPhone,
    });
    if (!parsedContact.success) {
      return { fieldErrors: zodFieldErrors(parsedContact.error), message: "Fix the fields marked below." };
    }

    const created = await saveCustomer(null, parsedCustomer.data, user.id);

    const addressTrim = address.trim();
    if (addressTrim) {
      await db.customer.update({ where: { id: created.id }, data: { address: addressTrim.slice(0, 2000) } });
    }

    let contacts: { id: string; name: string; isMain: boolean }[] = [];
    const c = parsedContact.data;
    if (c.name) {
      const raw = (c.emailOrPhone ?? "").trim();
      const looksEmail = raw.includes("@");
      if (looksEmail && !z.email().safeParse(raw).success) {
        return { fieldErrors: { emailOrPhone: "Enter a valid email." }, message: "Fix the fields marked below." };
      }
      const contact = await addContact(
        { kind: "customer", id: created.id },
        {
          name: c.name,
          role: c.role,
          email: looksEmail ? raw.toLowerCase() : null,
          phone: looksEmail ? null : raw || null,
          isMain: true,
        },
        user.id,
      );
      contacts = [{ id: contact.id, name: contact.name, isMain: contact.isMain }];
    }

    revalidatePath("/customers");
    revalidatePath("/quotes");

    customer = {
      id: created.id,
      name: created.name,
      address: addressTrim || created.address,
      defaultTerms: created.defaultTerms,
      withholdingType: created.withholdingType,
      defaultWithholding: parseWithholdingPick(created.defaultWithholding),
      contacts,
    };
    return { ok: true, message: "Customer saved." };
  });
  return customer ? { ...result, customer } : result;
}
