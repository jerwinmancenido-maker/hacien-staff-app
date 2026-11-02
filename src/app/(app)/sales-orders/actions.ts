"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, requireActionPermission } from "@/lib/auth/current-user";
import { assertCanVoid, ForbiddenError } from "@/lib/permissions";
import { runAction } from "@/lib/actions";
import { updateSalesOrder, updateSalesOrderGovDeal, voidSalesOrder } from "@/lib/services/sales-orders";
import { recordDelivery, voidDelivery } from "@/lib/services/deliveries";
import { govDealInputSchema, salesOrderInputSchema, voidReasonSchema } from "@/lib/validation/quotes";
import { parseDeliveryForm } from "@/lib/validation/deliveries";
import { str, zodFieldErrors, type FormState } from "@/lib/validation/forms";
import { formFiles } from "@/lib/form-files";

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
    const user = await getCurrentUser();
    if (!user) throw new ForbiddenError();
    assertCanVoid(user);
    const parsed = voidReasonSchema.safeParse(reason);
    if (!parsed.success) return { fieldErrors: { reason: parsed.error.issues[0]?.message ?? "Give a reason." } };
    await voidSalesOrder(id, parsed.data, user);
    revalidatePath("/sales-orders");
    revalidatePath(`/sales-orders/${id}`);
    revalidatePath("/quotes");
    return { ok: true, message: "Sales order voided." };
  });
}

export async function recordDeliveryAction(salesOrderId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const parsed = parseDeliveryForm(form);
  if (!parsed.ok) {
    return { values: parsed.values, fieldErrors: parsed.fieldErrors, message: "Fix the fields marked below." };
  }
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const { files, error } = await formFiles(form);
    if (error) return { values: parsed.values, fieldErrors: { files: error } };
    await recordDelivery(salesOrderId, parsed.data, user, files);
    revalidatePath("/sales-orders");
    revalidatePath(`/sales-orders/${salesOrderId}`);
    return { ok: true, message: "Delivery recorded." };
  }, parsed.values);
}

export async function voidDeliveryAction(deliveryId: string, salesOrderId: string, reason: string): Promise<FormState> {
  return runAction(async () => {
    const user = await getCurrentUser();
    if (!user) throw new ForbiddenError();
    assertCanVoid(user);
    const parsed = voidReasonSchema.safeParse(reason);
    if (!parsed.success) return { fieldErrors: { reason: parsed.error.issues[0]?.message ?? "Give a reason." } };
    await voidDelivery(deliveryId, parsed.data, user);
    revalidatePath(`/sales-orders/${salesOrderId}`);
    return { ok: true, message: "Delivery voided." };
  });
}

export async function updateSalesOrderGovDealAction(salesOrderId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const values = {
    philgepsRef: str(form, "philgepsRef"),
    bidNo: str(form, "bidNo"),
    noaDate: str(form, "noaDate"),
    agencyPoNo: str(form, "agencyPoNo"),
    iarDate: str(form, "iarDate"),
  };
  const parsed = govDealInputSchema.safeParse(values);
  if (!parsed.success) {
    return { values, fieldErrors: zodFieldErrors(parsed.error), message: "Fix the fields marked below." };
  }
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    await updateSalesOrderGovDeal(salesOrderId, parsed.data, user);
    revalidatePath(`/sales-orders/${salesOrderId}`);
    revalidatePath("/billing", "layout");
    return { ok: true, message: "Government deal fields saved." };
  }, values);
}

export async function voidDeliveryForOrder(salesOrderId: string, deliveryId: string, reason: string): Promise<FormState> {
  return voidDeliveryAction(deliveryId, salesOrderId, reason);
}
