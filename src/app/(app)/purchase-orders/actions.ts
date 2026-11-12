"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCostAction } from "@/lib/auth/current-user";
import { assertCanMaintainPurchaseOrder, assertCanVoid } from "@/lib/permissions";
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
import { postSupplierReturn, voidSupplierReturn } from "@/lib/services/returns";
import { formFiles } from "@/lib/form-files";
import { billInputSchema, closeReasonSchema, createFromSoSchema, poInputSchema, returnInputSchema } from "@/lib/validation/purchasing";
import { voidReasonSchema } from "@/lib/validation/quotes";
import { formValues, str, zodFieldErrors, type FormState } from "@/lib/validation/forms";
import { db } from "@/lib/db";
import { DocRuleError } from "@/lib/documents/common";
import { createAttachments, discardUploads, prepareUploads } from "@/lib/services/attachments";
import { pickedAttachmentKind, PURCHASE_ORDER_ATTACHMENT_KINDS } from "@/lib/attachment-kinds";

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
    assertCanMaintainPurchaseOrder(user);
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
    assertCanMaintainPurchaseOrder(user);
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
    const user = await requireCostAction("view");
    assertCanVoid(user);
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

/**
 * REQ-ATTACH-001: attach files (the supplier's quote, other documents) to
 * this purchase order. Cost-gated like every PO write — the files are cost
 * data. A void PO takes no new files.
 */
export async function uploadPurchaseOrderAttachmentsAction(id: string, _prev: FormState, form: FormData): Promise<FormState> {
  return runAction(async (): Promise<FormState> => {
    const user = await requireCostAction("edit_data");
    const po = await db.purchaseOrder.findUnique({ where: { id }, select: { status: true } });
    if (!po) throw new DocRuleError("Purchase order not found.");
    if (po.status === "VOID") throw new DocRuleError("This purchase order is void, so files can't be attached to it.");
    const kind = pickedAttachmentKind(str(form, "kind"), PURCHASE_ORDER_ATTACHMENT_KINDS);
    if (!kind) return { fieldErrors: { kind: "Pick what kind of file this is." } };
    const { files, error } = await formFiles(form);
    if (error) return { fieldErrors: { files: error } };
    if (files.length === 0) return { fieldErrors: { files: "Pick at least one file to upload." } };
    const uploads = await prepareUploads(files);
    try {
      await db.$transaction(async (tx) => {
        // Re-check inside the transaction: a void that lands between the
        // check above and this insert must not leave files on a VOID PO.
        const fresh = await tx.purchaseOrder.findUnique({ where: { id }, select: { status: true } });
        if (!fresh) throw new DocRuleError("Purchase order not found.");
        if (fresh.status === "VOID") throw new DocRuleError("This purchase order is void, so files can't be attached to it.");
        await createAttachments(tx, uploads.map((u) => ({ ...u, kind })), { purchaseOrderId: id }, user.id);
      });
    } catch (e) {
      await discardUploads(uploads);
      throw e;
    }
    refresh(id);
    return { ok: true, message: "Files attached." };
  });
}

/** S-50: post a supplier return (RMA) against this PO. */
export async function postSupplierReturnAction(purchaseOrderId: string, _prev: FormState, form: FormData): Promise<FormState> {
  let goTo: string | null = null;
  const result = await runAction(async () => {
    const user = await requireCostAction("edit_data");
    assertCanMaintainPurchaseOrder(user);
    const parsed = returnInputSchema.safeParse(payload(form));
    if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), message: "Fix the fields marked below." };
    await postSupplierReturn(purchaseOrderId, parsed.data, user);
    refresh(purchaseOrderId);
    goTo = `/purchase-orders/${purchaseOrderId}?tab=returns`;
    return { ok: true };
  });
  if (goTo) redirect(goTo);
  return result;
}

/** S-50: void a supplier return; the quantities go back on the PO lines. */
export async function voidSupplierReturnAction(purchaseOrderId: string, id: string, reason: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireCostAction("view");
    assertCanVoid(user);
    await voidSupplierReturn(id, reason, user);
    refresh(purchaseOrderId);
    return { ok: true, message: "Return voided." };
  });
}
