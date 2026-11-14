"use server";

// Phase 3 #8b: warranty claim actions. Both require edit_data; the
// service re-checks permissions and enforces the claim rules (VOID
// receiving refused, duplicate active claim blocked, status moves
// limited to the approved transitions) inside its transaction.

import { revalidatePath } from "next/cache";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { DocRuleError } from "@/lib/documents/common";
import { isWarrantyClaimsEnabled } from "@/lib/purchasing/warranty-claims";
import { changeWarrantyClaimStatus, createWarrantyClaim } from "@/lib/services/warranty-claims";
import { createWarrantyClaimSchema, warrantyClaimStatusSchema } from "@/lib/validation/warranty-claims";
import { formValues, str, zodFieldErrors, type FormState } from "@/lib/validation/forms";

async function assertFeatureOn() {
  if (!(await isWarrantyClaimsEnabled())) {
    throw new DocRuleError("Warranty claims are not turned on. An admin can enable them in Settings → Features.");
  }
}

function refresh(purchaseOrderId: string) {
  revalidatePath("/receiving");
  revalidatePath(`/receiving/${purchaseOrderId}`);
  revalidatePath("/purchase-orders");
  revalidatePath(`/purchase-orders/${purchaseOrderId}`);
}

export async function createWarrantyClaimAction(
  purchaseOrderId: string,
  receivingReportItemId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const values = formValues(form);
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    await assertFeatureOn();
    const parsed = createWarrantyClaimSchema.safeParse({
      serialNumber: str(form, "serialNumber"),
      fault: str(form, "fault"),
      supplierRef: str(form, "supplierRef"),
    });
    if (!parsed.success) return { values, fieldErrors: zodFieldErrors(parsed.error), message: "Fix the fields marked below." };
    try {
      await createWarrantyClaim(receivingReportItemId, parsed.data, user);
    } catch (e) {
      if (e instanceof DocRuleError) {
        return { values, message: e.message, ...(e.field ? { fieldErrors: { [e.field]: e.message } } : {}) };
      }
      throw e;
    }
    refresh(purchaseOrderId);
    return { ok: true, message: "Warranty claim filed as Open." };
  }, values);
}

export async function changeWarrantyClaimStatusAction(
  purchaseOrderId: string,
  claimId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const values = formValues(form);
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    await assertFeatureOn();
    const parsed = warrantyClaimStatusSchema.safeParse(str(form, "status"));
    if (!parsed.success) return { values, message: "Pick a valid claim status." };
    try {
      await changeWarrantyClaimStatus(claimId, parsed.data, user);
    } catch (e) {
      if (e instanceof DocRuleError) return { values, message: e.message };
      throw e;
    }
    refresh(purchaseOrderId);
    return { ok: true, message: "Claim status updated." };
  }, values);
}
