"use server";

import { revalidatePath } from "next/cache";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { DocRuleError } from "@/lib/documents/common";
import { isBooksEnabled } from "@/lib/books/features";
import {
  markTaxCalendarDone,
  undoTaxCalendarDone,
  markTaxCalendarFiled,
  undoTaxCalendarFiled,
} from "@/lib/services/tax-calendar";
import { type UploadFile } from "@/lib/services/attachments";
import { ForbiddenError } from "@/lib/permissions";
import { formValues, type FormState } from "@/lib/validation/forms";

async function assertBooksOn() {
  if (!(await isBooksEnabled())) {
    throw new DocRuleError("Books is turned off. Enable it in Settings → Features (or BOOKS_ENABLED=true).");
  }
}

async function requireAdminAction() {
  const user = await requireActionPermission("view_books");
  if (!user.active || !user.isAdmin) {
    throw new ForbiddenError();
  }
  return user;
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

export async function markIncomeTaxFiledAction(_prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  const occurrenceKey = (values.occurrenceKey ?? "").trim();
  const filedDate = (values.filedDate ?? "").trim();
  const referenceNo = (values.referenceNo ?? "").trim();
  const note = (values.note ?? "").trim() || null;
  const dueYmd = (values.dueYmd ?? "").trim() || null;

  const fieldErrors: Record<string, string> = {};
  if (!occurrenceKey) fieldErrors.occurrenceKey = "Missing calendar item.";
  if (!filedDate) fieldErrors.filedDate = "Enter the date you filed.";
  if (!referenceNo) fieldErrors.referenceNo = "Enter the BIR filing reference number.";

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    fieldErrors.file = "Attach the eFPS or eBIRForms confirmation.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { values, fieldErrors };
  }

  return runAction(async () => {
    await assertBooksOn();
    const user = await requireAdminAction();
    const f = file as File;
    const uploadFile: UploadFile = {
      name: f.name,
      size: f.size,
      bytes: new Uint8Array(await f.arrayBuffer()),
    };
    await markTaxCalendarFiled(
      {
        occurrenceKey,
        filedDateYmd: filedDate,
        referenceNo,
        file: uploadFile,
        dueYmd,
        note,
      },
      user,
    );
    revalidatePath("/");
    revalidatePath("/books/tax/calendar");
    return { ok: true, values, message: "Recorded that you filed with BIR." };
  }, values);
}

export async function undoIncomeTaxFiledAction(_prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  const occurrenceKey = (values.occurrenceKey ?? "").trim();
  const reason = (values.reason ?? "").trim();

  const fieldErrors: Record<string, string> = {};
  if (!occurrenceKey) fieldErrors.occurrenceKey = "Missing calendar item.";
  if (!reason) fieldErrors.reason = "Provide a reason for undoing this filing.";

  if (Object.keys(fieldErrors).length > 0) {
    return { values, fieldErrors };
  }

  return runAction(async () => {
    await assertBooksOn();
    const user = await requireAdminAction();
    await undoTaxCalendarFiled({ occurrenceKey, reason }, user);
    revalidatePath("/");
    revalidatePath("/books/tax/calendar");
    return { ok: true, values, message: "Undid the filing record." };
  }, values);
}
