"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { db } from "@/lib/db";
import { DocRuleError } from "@/lib/documents/common";
import { postReceivingReport, ReceiptError, voidReceivingReport } from "@/lib/services/receiving";
import { receiptInputSchema } from "@/lib/validation/purchasing";
import { voidReasonSchema } from "@/lib/validation/quotes";
import { formValues, str, zodFieldErrors, type FormState } from "@/lib/validation/forms";
import { formFiles } from "@/lib/form-files";

function refresh(poId: string) {
  revalidatePath("/receiving");
  revalidatePath(`/receiving/${poId}`);
  revalidatePath("/purchase-orders");
  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath("/sales-orders", "layout");
}

export async function postReceivingReportAction(purchaseOrderId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  let goTo: string | null = null;
  const result = await runAction(async () => {
    const user = await requireActionPermission("edit_data");
    let raw: unknown = null;
    try {
      raw = JSON.parse(str(form, "payload"));
    } catch {
      // handled by the schema
    }
    const parsed = receiptInputSchema.safeParse(raw);
    if (!parsed.success) return { values, fieldErrors: zodFieldErrors(parsed.error), message: "Fix the fields marked below." };
    const { files, error } = await formFiles(form);
    if (error) return { values, fieldErrors: { files: error } };
    try {
      await postReceivingReport(purchaseOrderId, parsed.data, user, files);
    } catch (e) {
      if (e instanceof ReceiptError) {
        return { values, message: e.message, fieldErrors: Object.fromEntries(Object.entries(e.lineErrors).map(([k, v]) => [`line.${k}`, v])) };
      }
      throw e;
    }
    refresh(purchaseOrderId);
    goTo = `/receiving/${purchaseOrderId}?posted=1`;
    return { ok: true };
  }, values);
  if (goTo) redirect(goTo);
  return result;
}

export async function voidReceivingReportAction(purchaseOrderId: string, id: string, reason: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const parsed = voidReasonSchema.safeParse(reason);
    if (!parsed.success) return { fieldErrors: { reason: parsed.error.issues[0]?.message ?? "Give a reason." } };
    try {
      await voidReceivingReport(id, parsed.data, user);
    } catch (e) {
      if (e instanceof DocRuleError && e.message === "Void the supplier bill first.") {
        const bill = await db.supplierBill.findFirst({
          where: { purchaseOrderId, status: { not: "VOID" } },
          select: { id: true, billNumber: true },
          orderBy: { createdAt: "asc" },
        });
        return {
          message: "Void the supplier bill first.",
          values: {
            billHref: `/purchase-orders/${purchaseOrderId}`,
            billLabel: bill ? `bill ${bill.billNumber}` : "supplier bill",
          },
        };
      }
      throw e;
    }
    refresh(purchaseOrderId);
    return { ok: true, message: "Receiving report voided." };
  });
}
