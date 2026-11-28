"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { db } from "@/lib/db";
import { DocRuleError } from "@/lib/documents/common";
import { isPayablesEnabled } from "@/lib/payables/features";
import { approvePaymentRequest, createPaymentRequest, rejectPaymentRequest } from "@/lib/services/payment-requests";
import { parsePaymentRequestForm } from "@/lib/validation/payables";
import { type FormState } from "@/lib/validation/forms";

async function assertFeatureOn() {
  if (!(await isPayablesEnabled())) throw new DocRuleError("Payables is turned off. Enable it in Settings → Features (or PAYABLES_ENABLED=true).");
}

async function refresh(requestId?: string) {
  revalidatePath("/payables", "layout");
  if (requestId) {
    const req = await db.supplierPaymentRequest.findUnique({
      where: { id: requestId },
      select: { supplierBill: { select: { purchaseOrderId: true, supplierId: true } } },
    });
    if (req?.supplierBill.purchaseOrderId) revalidatePath(`/purchase-orders/${req.supplierBill.purchaseOrderId}`);
    if (req?.supplierBill.supplierId) revalidatePath(`/suppliers/${req.supplierBill.supplierId}`);
  }
}

export async function createPaymentRequestAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = parsePaymentRequestForm(form);
  if (!parsed.ok) return { values: parsed.values, fieldErrors: parsed.fieldErrors, message: "Fix the fields marked below." };
  let goTo: string | null = null;
  const result = await runAction(async () => {
    await assertFeatureOn();
    const user = await requireActionPermission("edit_data");
    const request = await createPaymentRequest(parsed.data, user);
    await refresh(request.id);
    goTo = "/payables/payment-requests";
    return { ok: true };
  }, parsed.values);
  if (goTo) redirect(goTo);
  return result;
}

export async function approvePaymentRequestAction(id: string, _prev: FormState, _form: FormData): Promise<FormState> {
  return runAction(async () => {
    await assertFeatureOn();
    const user = await requireActionPermission("approve");
    await approvePaymentRequest(id, user);
    await refresh(id);
    return { ok: true, message: "Request approved — it can now be paid." };
  });
}

export async function rejectPaymentRequestAction(id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const note = String(form.get("note") ?? "");
  return runAction(async () => {
    await assertFeatureOn();
    const user = await requireActionPermission("approve");
    await rejectPaymentRequest(id, note, user);
    await refresh(id);
    return { ok: true, message: "Request rejected." };
  });
}
