"use server";

import { revalidatePath } from "next/cache";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { DocRuleError } from "@/lib/documents/common";
import { isBooksEnabled } from "@/lib/books/features";
import { saveTaxPaidQuarter } from "@/lib/services/tax-worksheets";
import { isQuarter, type Quarter } from "@/lib/tax/quarters";
import { formValues, type FormState } from "@/lib/validation/forms";

async function assertBooksOn() {
  if (!(await isBooksEnabled())) {
    throw new DocRuleError("Books is turned off. Enable it in Settings → Features (or BOOKS_ENABLED=true).");
  }
}

export async function saveTaxPaidAction(_prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  const year = Number(values.year);
  const quarter = Number(values.quarter);
  const amountPaid = (values.amountPaid ?? "").trim();
  const notes = (values.notes ?? "").trim() || null;

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return { values, fieldErrors: { year: "Pick a valid year." } };
  }
  if (!isQuarter(quarter)) {
    return { values, fieldErrors: { quarter: "Pick a quarter (1–4)." } };
  }
  if (!amountPaid) {
    return { values, fieldErrors: { amountPaid: "Enter the amount paid." } };
  }

  return runAction(async () => {
    await assertBooksOn();
    const user = await requireActionPermission("view_books");
    await saveTaxPaidQuarter(
      { year, quarter: quarter as Quarter, amountPaid, notes },
      user,
    );
    revalidatePath("/books/tax", "layout");
    revalidatePath("/books/tax/income");
    return { ok: true, values, message: `Saved tax paid for Q${quarter} ${year}.` };
  }, values);
}
