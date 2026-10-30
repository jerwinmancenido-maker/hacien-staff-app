"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCostAction } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import {
  approvePurchaseOrder,
  buildPoEmailDraft,
  closePurchaseOrder,
  createPurchaseOrdersFromSalesOrder,
  createStandalonePurchaseOrder,
  markPurchaseOrderSent,
  updatePurchaseOrder,
  voidPurchaseOrder,
  type EmailDraft,
} from "@/lib/services/purchase-orders";
import { recordSupplierBill, voidSupplierBill } from "@/lib/services/supplier-bills";
import { formFiles } from "@/lib/form-files";
import { billInputSchema, closeReasonSchema, createFromSoSchema, poInputSchema } from "@/lib/validation/purchasing";
import { voidReasonSchema } from "@/lib/validation/quotes";
import { formValues, str, zodFieldErrors, type FormState } from "@/lib/validation/forms";

function payload(form: FormData): unknown {
  try {
    return JSON.parse(str(form, "payload"));
  } catch {
    return null;
  }
}

function refresh(id?: string) {
  revalidatePath("/purchase-orders");
  revalidatePath("/receiving");
  if (id) revalidatePath(`/purchase-orders/${id}`);
}

export async function createPosFromSalesOrderAction(salesOrderId: string, _prev: FormState, form: FormData): Promise<FormState> {
  let goTo: string | null = null;
  const result = await runAction(async () => {
    const user = await requireCostAction("edit_data");
    const parsed = createFromSoSchema.safeParse(payload(form));
    if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), message: "Fix the fields marked below." };
    const pos = await createPurchaseOrdersFromSalesOrder(salesOrderId, parsed.data, user);
    refresh();
    revalidatePath(`/sales-orders/${salesOrderId}`);
    goTo = pos.length === 1 ? `/purchase-orders/${pos[0]!.id}` : `/sales-orders/${salesOrderId}?created=${pos.length}`;
    return { ok: true };
  });
  if (goTo) redirect(goTo);
  return result;
}

export async function savePurchaseOrderAction(id: string | null, _prev: FormState, form: FormData): Promise<FormState> {
  let goTo: string | null = null;
  const result = await runAction(async () => {
    const user = await requireCostAction("edit_data");
    const parsed = poInputSchema.safeParse(payload(form));
    if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), message: "Fix the fields marked below." };
    const po = id ? await updatePurchaseOrder(id, parsed.data, user) : await createStandalonePurchaseOrder(parsed.data, user);
    refresh(po.id);
    goTo = `/purchase-orders/${po.id}`;
    return { ok: true };
  });
  if (goTo) redirect(goTo);
  return result;
}

export async function approvePurchaseOrderAction(id: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireCostAction("approve");
    await approvePurchaseOrder(id, user);
    refresh(id);
    return { ok: true, message: "Approved." };
  });
}

export async function markPurchaseOrderSentAction(id: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireCostAction("edit_data");
    await markPurchaseOrderSent(id, user);
    refresh(id);
    return { ok: true, message: "Marked as sent." };
  });
}

export async function closePurchaseOrderAction(id: string, reason: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireCostAction("edit_data");
    const parsed = closeReasonSchema.safeParse(reason);
    if (!parsed.success) return { fieldErrors: { reason: parsed.error.issues[0]?.message ?? "Check the reason." } };
    await closePurchaseOrder(id, parsed.data || null, user);
    refresh(id);
    return { ok: true, message: "PO closed." };
  });
}

export async function voidPurchaseOrderAction(id: string, reason: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireCostAction("edit_data");
    const parsed = voidReasonSchema.safeParse(reason);
    if (!parsed.success) return { fieldErrors: { reason: parsed.error.issues[0]?.message ?? "Give a reason." } };
    const po = await voidPurchaseOrder(id, parsed.data, user);
    refresh(id);
    if (po.salesOrderId) revalidatePath(`/sales-orders/${po.salesOrderId}`);
    return { ok: true, message: "PO voided." };
  });
}

export async function emailPurchaseOrderAction(id: string): Promise<FormState & { draft?: EmailDraft }> {
  try {
    const user = await requireCostAction("edit_data");
    const draft = await buildPoEmailDraft(id, user);
    return { ok: true, draft };
  } catch (e) {
    const res = await runAction(async () => {
      throw e;
    });
    return res;
  }
}

export async function recordBillAction(purchaseOrderId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  let goTo: string | null = null;
  const result = await runAction(async () => {
    const user = await requireCostAction("edit_data");
    const raw = payload(form) as Record<string, unknown> | null;
    const parsed = billInputSchema.safeParse(raw);
    if (!parsed.success) return { values, fieldErrors: zodFieldErrors(parsed.error), message: "Fix the fields marked below." };
    const { files, error } = await formFiles(form);
    if (error) return { values, fieldErrors: { files: error } };
    await recordSupplierBill(purchaseOrderId, parsed.data, user, files);
    refresh(purchaseOrderId);
    goTo = `/purchase-orders/${purchaseOrderId}?tab=match`;
    return { ok: true };
  }, values);
  if (goTo) redirect(goTo);
  return result;
}

export async function voidBillAction(purchaseOrderId: string, billId: string, reason: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireCostAction("edit_data");
    const parsed = voidReasonSchema.safeParse(reason);
    if (!parsed.success) return { fieldErrors: { reason: parsed.error.issues[0]?.message ?? "Give a reason." } };
    await voidSupplierBill(billId, parsed.data, user);
    refresh(purchaseOrderId);
    return { ok: true, message: "Bill voided." };
  });
}
