"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { updateSalesOrder, voidSalesOrder } from "@/lib/services/sales-orders";
import { salesOrderInputSchema, voidReasonSchema } from "@/lib/validation/quotes";
import { str, zodFieldErrors, type FormState } from "@/lib/validation/forms";

export async function saveSalesOrderAction(id: string, _prev: FormState, form: FormData): Promise<FormState> {
  let goTo: string | null = null;
  const result = await runAction(async () => {
    const user = await requireActionPermission("edit_data");
    let raw: unknown = null;
    try {
      raw = JSON.parse(str(form, "payload"));
    } catch {
      // handled by the schema below
    }
    const parsed = salesOrderInputSchema.safeParse(raw);
    if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), message: "Fix the fields marked below." };
    await updateSalesOrder(id, parsed.data, user);
    revalidatePath("/sales-orders");
    revalidatePath(`/sales-orders/${id}`);
    goTo = `/sales-orders/${id}`;
    return { ok: true };
  });
  if (goTo) redirect(goTo);
  return result;
}

export async function voidSalesOrderAction(id: string, reason: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const parsed = voidReasonSchema.safeParse(reason);
    if (!parsed.success) return { fieldErrors: { reason: parsed.error.issues[0]?.message ?? "Give a reason." } };
    await voidSalesOrder(id, parsed.data, user);
    revalidatePath("/sales-orders");
    revalidatePath(`/sales-orders/${id}`);
    revalidatePath("/quotes");
    return { ok: true, message: "Sales order voided." };
  });
}
