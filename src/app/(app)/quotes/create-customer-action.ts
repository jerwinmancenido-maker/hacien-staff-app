"use server";

// Inline "Add new customer" from the quote editor.
// Validates all fields up front and saves customer, addresses (Billing + Delivery),
// and contact in ONE prisma transaction. Never redirects (quote form data stays intact).

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { getSettingsSnapshot } from "@/lib/settings";
import { listWithholdingRates } from "@/lib/services/withholding";
import { parseWithholdingPick, resolveCustomerSavedPick } from "@/lib/quotes/withholding-defaults";
import { customerSchema, phoneField, WITHHOLDING_TYPES } from "@/lib/validation/companies";
import { str, zodFieldErrors, type FormState } from "@/lib/validation/forms";
import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .transform((v) => (v ? v : null));

/** Contact fields for the quote drawer (role is free text / Position). */
const quoteDrawerContactSchema = z
  .object({
    name: z.string().trim().max(191).transform((v) => (v ? v : null)),
    role: optionalText(100),
    email: z
      .string()
      .trim()
      .max(191)
      .refine((v) => !v || z.string().email().safeParse(v).success, "Enter a valid email.")
      .transform((v) => (v ? v.toLowerCase() : null)),
    phone: phoneField(64),
  })
  .superRefine((v, ctx) => {
    if (!v.name && (v.role || v.email || v.phone)) {
      ctx.addIssue({ code: "custom", path: ["contactName"], message: "Contact name is required when adding a contact." });
    }
    if (v.name && !v.email && !v.phone) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "Add an email or a phone number." });
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
  creditLimit: string | null;
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
    const defaultTerms = str(form, "defaultTerms");
    const address = str(form, "address");
    const barangay = str(form, "barangay");
    const cityMunicipality = str(form, "cityMunicipality");
    const province = str(form, "province");
    const zip = str(form, "zip");
    const contactName = str(form, "contactName");
    const contactRole = str(form, "contactRole");
    const email = str(form, "email");
    const phone = str(form, "phone");
    const pick = resolveCustomerSavedPick(withholdingType, parsePickFromForm(form));

    // 1. Validate customer fields
    const parsedCustomer = customerSchema(settings.lists.paymentTerms, activeCodes).safeParse({
      name,
      tin,
      withholdingType: withholdingType || undefined,
      defaultWithholding: pick,
      defaultTerms,
      notes: "",
    });

    // 2. Validate contact fields
    const parsedContact = quoteDrawerContactSchema.safeParse({
      name: contactName,
      role: contactRole,
      email,
      phone,
    });

    const fieldErrors: Record<string, string> = {};
    if (!parsedCustomer.success) {
      Object.assign(fieldErrors, zodFieldErrors(parsedCustomer.error));
    }
    const effectiveType = parsedCustomer.data?.withholdingType ?? withholdingType;
    if (!effectiveType || !(WITHHOLDING_TYPES as readonly string[]).includes(effectiveType)) {
      fieldErrors.withholdingType = "Pick a type.";
    }
    if (!parsedContact.success) {
      Object.assign(fieldErrors, zodFieldErrors(parsedContact.error));
    }

    if (Object.keys(fieldErrors).length > 0) {
      return { fieldErrors, message: "Fix the fields marked below." };
    }

    if (!parsedCustomer.success || !parsedContact.success) {
      return { fieldErrors, message: "Fix the fields marked below." };
    }

    // Check TIN clash before transaction
    if (parsedCustomer.data.tin) {
      const clash = await db.customer.findFirst({ where: { tin: parsedCustomer.data.tin } });
      if (clash) {
        return { fieldErrors: { tin: `This TIN belongs to ${clash.name}.` }, message: "Fix the fields marked below." };
      }
    }

    // 3. Create all in ONE transaction
    const addressTrim = address.trim();
    // Split address parts, same fields as the full customer form. Barangay is
    // optional; the address counts as complete (no review needed) when street,
    // city, province and ZIP are all filled.
    const barangayTrim = barangay.trim().slice(0, 120);
    const cityTrim = cityMunicipality.trim().slice(0, 120);
    const provinceTrim = province.trim().slice(0, 120);
    const zipTrim = zip.trim().slice(0, 4);
    const addressComplete = Boolean(addressTrim && cityTrim && provinceTrim && zipTrim);
    const cData = parsedCustomer.data;
    const contactData = parsedContact.data;

    const { newCustomer, newContacts } = await db.$transaction(async (tx) => {
      const created = await tx.customer.create({
        data: {
          name: cData.name,
          tin: cData.tin,
          withholdingType: cData.withholdingType,
          defaultWithholding: cData.defaultWithholding === null ? Prisma.DbNull : cData.defaultWithholding,
          defaultTerms: cData.defaultTerms,
          notes: null,
        },
      });
      await writeAudit(tx, {
        userId: user.id,
        entityType: "Customer",
        entityId: created.id,
        action: "create",
        after: created,
      });

      if (addressTrim) {
        // Save into Address rows (Billing + Delivery, both default), NOT the old hidden free-text field
        const billingAddr = await tx.address.create({
          data: {
            customerId: created.id,
            kind: "BILLING",
            street: addressTrim.slice(0, 1000),
            barangay: barangayTrim,
            cityMunicipality: cityTrim,
            province: provinceTrim,
            zip: zipTrim,
            isDefault: true,
            needsReview: !addressComplete,
          },
        });
        await writeAudit(tx, {
          userId: user.id,
          entityType: "Address",
          entityId: billingAddr.id,
          action: "create",
          after: billingAddr,
        });

        const deliveryAddr = await tx.address.create({
          data: {
            customerId: created.id,
            kind: "DELIVERY",
            street: addressTrim.slice(0, 1000),
            barangay: barangayTrim,
            cityMunicipality: cityTrim,
            province: provinceTrim,
            zip: zipTrim,
            isDefault: true,
            needsReview: !addressComplete,
          },
        });
        await writeAudit(tx, {
          userId: user.id,
          entityType: "Address",
          entityId: deliveryAddr.id,
          action: "create",
          after: deliveryAddr,
        });
      }

      let createdContacts: { id: string; name: string; isMain: boolean }[] = [];
      if (contactData.name) {
        const contact = await tx.contact.create({
          data: {
            customerId: created.id,
            name: contactData.name,
            role: contactData.role,
            email: contactData.email,
            phone: contactData.phone,
            isMain: true,
          },
        });
        await writeAudit(tx, {
          userId: user.id,
          entityType: "Contact",
          entityId: contact.id,
          action: "create",
          after: contact,
        });
        createdContacts = [{ id: contact.id, name: contact.name, isMain: contact.isMain }];
      }

      return { newCustomer: created, newContacts: createdContacts };
    });

    revalidatePath("/customers");
    revalidatePath("/quotes");

    customer = {
      id: newCustomer.id,
      name: newCustomer.name,
      address: addressTrim || null,
      defaultTerms: newCustomer.defaultTerms,
      withholdingType: newCustomer.withholdingType,
      defaultWithholding: parseWithholdingPick(newCustomer.defaultWithholding),
      creditLimit: newCustomer.creditLimit === null ? null : String(newCustomer.creditLimit),
      contacts: newContacts,
    };
    return { ok: true, message: "Customer saved." };
  });

  return customer ? { ...result, customer } : result;
}
