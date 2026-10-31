"use server";

import { revalidatePath } from "next/cache";
import { requireActionPermission } from "@/lib/auth/current-user";
import { getSettingsSnapshot } from "@/lib/settings";
import { saveCustomer } from "@/lib/services/companies";
import { listWithholdingRates } from "@/lib/services/withholding";
import { customerSchema } from "@/lib/validation/companies";
import { zodFieldErrors } from "@/lib/validation/forms";
import { parseWithholdingPick } from "@/lib/quotes/withholding-defaults";
import type { EditorCustomer } from "@/components/docs/DocumentEditor";

export type CreateCustomerFromQuoteInput = {
  name: string;
  tin?: string;
  withholdingType: string;
  defaultWithholding: string[] | null;
};

export type CreateCustomerFromQuoteResult =
  | { ok: true; customer: EditorCustomer }
  | { ok: false; message?: string; fieldErrors?: Record<string, string> };

/** Create a customer from the quote editor drawer (edit_data required). */
export async function createCustomerFromQuoteAction(
  input: CreateCustomerFromQuoteInput,
): Promise<CreateCustomerFromQuoteResult> {
  try {
    const user = await requireActionPermission("edit_data");
    const { settings } = await getSettingsSnapshot();
    const activeCodes = (await listWithholdingRates(undefined, { activeOnly: true })).map((r) => r.code);
    const pick = parseWithholdingPick(input.defaultWithholding);
    const parsed = customerSchema(settings.lists.paymentTerms, activeCodes).safeParse({
      name: input.name,
      tin: input.tin ?? "",
      withholdingType: input.withholdingType || undefined,
      defaultWithholding: pick,
      defaultTerms: "",
      notes: "",
    });
    if (!parsed.success) {
      return { ok: false, fieldErrors: zodFieldErrors(parsed.error), message: "Check the highlighted fields." };
    }
    const saved = await saveCustomer(null, parsed.data, user.id);
    revalidatePath("/customers");
    revalidatePath(`/customers/${saved.id}`);
    revalidatePath("/quotes");
    return {
      ok: true,
      customer: {
        id: saved.id,
        name: saved.name,
        address: saved.address ?? null,
        defaultTerms: saved.defaultTerms ?? null,
        withholdingType: saved.withholdingType,
        defaultWithholding: parseWithholdingPick(saved.defaultWithholding),
        contacts: [],
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save customer.";
    return { ok: false, message };
  }
}
