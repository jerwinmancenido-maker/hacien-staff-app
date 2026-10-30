"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { markSupplier2307Issued, recordSupplierPayment, voidSupplierPayment } from "@/lib/services/supplier-payments";
import { markSupplier2307IssuedSchema, parseSupplierPaymentForm } from "@/lib/validation/payables";
import { voidReasonSchema } from "@/lib/validation/quotes";
import { type FormState } from "@/lib/validation/forms";
import { formFiles } from "@/lib/form-files";
import { isPayablesEnabled } from "@/lib/payables/features";
import { DocRuleError } from "@/lib/documents/common";

async function assertFeatureOn() {
  if (!(await isPayablesEnabled())) throw new DocRuleError("Payables is turned off. Enable it in Settings → Features (or PAYABLES_ENABLED=true).");
}

function refreshPayables(supplierId?: string | null, paymentId?: string | null) {
  revalidatePath("/payables", "layout");
  if (paymentId) revalidatePath(`/payables/payments/${paymentId}`);
  if (supplierId) revalidatePath(`/suppliers/${supplierId}`);
}

export async function recordSupplierPaymentAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = parseSupplierPaymentForm(form);
  if (!parsed.ok) return { values: parsed.values, fieldErrors: parsed.fieldErrors, message: "Fix the fields marked below." };
  const echo: Record<string, string> = {
    supplierId: parsed.data.supplierId,
    date: parsed.data.date.toISOString().slice(0, 10),
    method: parsed.data.method,
    reference: parsed.data.reference ?? "",
    checkBank: parsed.data.checkBank ?? "",
    checkDate: parsed.data.checkDate ? parsed.data.checkDate.toISOString().slice(0, 10) : "",
    amountPaid: parsed.data.amountPaid,
    cashAccountId: parsed.data.cashAccountId ?? "",
    notes: parsed.data.notes ?? "",
  };
  let goTo: string | null = null;
  const result = await runAction(async () => {
    await assertFeatureOn();
    const user = await requireActionPermission("manage_payables");
    const { files, error } = await formFiles(form);
    if (error) return { values: echo, fieldErrors: { files: error } };
    const payment = await recordSupplierPayment(parsed.data, user, files);
    refreshPayables(payment.supplierId, payment.id);
    goTo = `/payables/payments/${payment.id}`;
    return { ok: true };
  }, echo);
  if (goTo) redirect(goTo);
  return result;
}

export async function voidSupplierPaymentAction(id: string, reason: string): Promise<FormState> {
  return runAction(async () => {
    await assertFeatureOn();
    const user = await requireActionPermission("manage_payables");
    const parsed = voidReasonSchema.safeParse(reason);
    if (!parsed.success) return { fieldErrors: { reason: parsed.error.issues[0]?.message ?? "Give a reason." } };
    const payment = await voidSupplierPayment(id, parsed.data, user);
    refreshPayables(payment.supplierId, payment.id);
    return { ok: true, message: "Payment voided." };
  });
}

export async function markSupplier2307IssuedAction(id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const values = {
    issuedAt: String(form.get("issuedAt") ?? ""),
    notes: String(form.get("notes") ?? ""),
  };
  const parsed = markSupplier2307IssuedSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[i.path.join(".") || "_"] ??= i.message;
    return { values, fieldErrors, message: "Fix the fields marked below." };
  }
  return runAction(async () => {
    await assertFeatureOn();
    const user = await requireActionPermission("manage_payables");
    const { files, error } = await formFiles(form);
    if (error) return { values, fieldErrors: { files: error } };
    await markSupplier2307Issued(id, parsed.data, user, files);
    revalidatePath("/payables/2307");
    revalidatePath("/payables", "layout");
    return { ok: true, message: "Marked issued." };
  }, values);
}
