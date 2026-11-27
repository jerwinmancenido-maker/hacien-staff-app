"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { convertStoreOrder, type ConvertStoreOrderInput } from "@/lib/store-orders/convert";
import { convertStoreOrderInputSchema } from "@/lib/validation/store-orders";
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
