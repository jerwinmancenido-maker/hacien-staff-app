"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { convertStoreOrder, type ConvertStoreOrderInput } from "@/lib/store-orders/convert";
import { markStoreOrderProvisioning, refundStoreOrder } from "@/lib/store-orders/refund";
import { convertStoreOrderInputSchema, refundStoreOrderInputSchema } from "@/lib/validation/store-orders";
import { zodFieldErrors, type FormState } from "@/lib/validation/forms";

/**
 * Convert a PAID store order into SO + billing + collection (Slice 2).
 * Approve-gated (Admin/Approver): conversion creates a sales order, a
 * billing on a booklet SI and a collection in one transaction.
 */
export async function convertStoreOrderAction(id: string, input: ConvertStoreOrderInput): Promise<FormState> {
  let goTo: string | null = null;
  const result = await runAction(async () => {
    const user = await requireActionPermission("approve");
    const parsed = convertStoreOrderInputSchema.safeParse(input);
    if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), message: "Fix the fields marked below." };
    const converted = await convertStoreOrder(id, parsed.data, user);
    revalidatePath("/store-orders");
    revalidatePath(`/store-orders/${id}`);
    revalidatePath("/sales-orders");
    goTo = `/sales-orders/${converted.salesOrderId}`;
    return { ok: true };
  });
  if (goTo) redirect(goTo);
  return result;
}

/**
 * Mark a converted store order PROVISIONING (Slice 3). Edit-gated: a
 * plain fulfilment state for subscription orders; DONE stays derived
 * from the linked sales order's CLOSED status, never set by hand.
 */
export async function markStoreOrderProvisioningAction(id: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    await markStoreOrderProvisioning(id, user);
    revalidatePath("/store-orders");
    revalidatePath(`/store-orders/${id}`);
    return { ok: true };
  });
}

/**
 * Run (or resume) the refund / chargeback mirror (Slice 3).
 * Manage-billing-gated (Admin/Approver): runs the existing void services
 * over the converted chain — collection, billing, sales order, gateway
 * fee expense — and only then records the terminal status. A guard
 * error (closed period, received 2307) stops the sequence and surfaces
 * here; running it again finishes the remaining steps.
 */
export async function refundStoreOrderAction(
  id: string,
  input: { kind: "REFUNDED" | "CHARGEBACK"; reason: string },
): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("manage_billing");
    const parsed = refundStoreOrderInputSchema.safeParse(input);
    if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), message: "Fix the fields marked below." };
    await refundStoreOrder(id, parsed.data, user);
    revalidatePath("/store-orders");
    revalidatePath(`/store-orders/${id}`);
    revalidatePath("/sales-orders");
    revalidatePath("/billing/billings");
    revalidatePath("/billing/collections");
    revalidatePath("/cash/expenses");
    revalidatePath("/cash");
    return { ok: true };
  });
}
