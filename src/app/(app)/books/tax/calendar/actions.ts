"use server";

import { revalidatePath } from "next/cache";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { DocRuleError } from "@/lib/documents/common";
import { isBooksEnabled } from "@/lib/books/features";
import { markTaxCalendarDone, undoTaxCalendarDone } from "@/lib/services/tax-calendar";
import { formValues, type FormState } from "@/lib/validation/forms";

async function assertBooksOn() {
  if (!(await isBooksEnabled())) {
    throw new DocRuleError("Books is turned off. Enable it in Settings → Features (or BOOKS_ENABLED=true).");
  }
}

export async function markTaxCalendarDoneAction(_prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  const occurrenceKey = (values.occurrenceKey ?? "").trim();
  const doneDate = (values.doneDate ?? "").trim();
  const note = (values.note ?? "").trim() || null;
  const dueYmd = (values.dueYmd ?? "").trim() || null;

  if (!occurrenceKey) {
    return { values, fieldErrors: { occurrenceKey: "Missing calendar item." } };
  }
  if (!doneDate) {
    return { values, fieldErrors: { doneDate: "Enter the date you marked this done." } };
  }

  return runAction(async () => {
    await assertBooksOn();
    const user = await requireActionPermission("view_books");
    await markTaxCalendarDone(
      { occurrenceKey, doneDateYmd: doneDate, note, dueYmd },
      user,
    );
    revalidatePath("/books/tax/calendar");
    return { ok: true, values, message: "Marked as done (staff note only — not a filing)." };
  }, values);
}

export async function undoTaxCalendarDoneAction(_prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  const occurrenceKey = (values.occurrenceKey ?? "").trim();
  if (!occurrenceKey) {
    return { values, fieldErrors: { occurrenceKey: "Missing calendar item." } };
  }

  return runAction(async () => {
    await assertBooksOn();
    const user = await requireActionPermission("view_books");
    await undoTaxCalendarDone({ occurrenceKey }, user);
    revalidatePath("/books/tax/calendar");
    return { ok: true, values, message: "Undid the mark-as-done note." };
  }, values);
}
