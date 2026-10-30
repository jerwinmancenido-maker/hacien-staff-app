"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { recordBilling, updateBilling, voidBilling } from "@/lib/services/billings";
import { applyCustomerCredit, mark2307Received, recordCollection, voidCollection } from "@/lib/services/collections";
import {
  applyCreditInputSchema,
  mark2307ReceivedSchema,
  parseBillingForm,
  parseCollectionForm,
} from "@/lib/validation/billing";
import { voidReasonSchema } from "@/lib/validation/quotes";
import { formValues, str, zodFieldErrors, type FormState } from "@/lib/validation/forms";
import { formFiles } from "@/lib/form-files";

function refreshBilling(customerId?: string | null, salesOrderId?: string | null, billingId?: string | null) {
  revalidatePath("/billing", "layout");
  if (billingId) revalidatePath(`/billing/billings/${billingId}`);
  if (customerId) {
    revalidatePath(`/customers/${customerId}`);
    revalidatePath(`/print/statements/${customerId}`);
  }
  if (salesOrderId) revalidatePath(`/sales-orders/${salesOrderId}`);
}

export async function recordBillingAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = parseBillingForm(form);
  if (!parsed.ok) return { values: parsed.values, fieldErrors: parsed.fieldErrors, message: "Fix the fields marked below." };
  const echo = {
    salesOrderId: parsed.data.salesOrderId,
    amount: parsed.data.amount,
    invoiceNo: String(parsed.data.invoiceNo),
    invoiceDate: parsed.data.invoiceDate.toISOString().slice(0, 10),
    dueDate: parsed.data.dueDate.toISOString().slice(0, 10),
    notes: parsed.data.notes ?? "",
  };
  let goTo: string | null = null;
  const result = await runAction(async () => {
    const user = await requireActionPermission("manage_billing");
    const { files, error } = await formFiles(form);
    if (error) return { values: echo, fieldErrors: { files: error } };
    const billing = await recordBilling(parsed.data, user, files);
    refreshBilling(billing.customerId, billing.salesOrderId, billing.id);
    goTo = `/billing/billings/${billing.id}`;
    return { ok: true };
  }, echo);
  if (goTo) redirect(goTo);
  return result;
}

export async function updateBillingAction(id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const parsed = parseBillingForm(form);
  if (!parsed.ok) return { values: parsed.values, fieldErrors: parsed.fieldErrors, message: "Fix the fields marked below." };
  return runAction(async () => {
    const user = await requireActionPermission("manage_billing");
    const billing = await updateBilling(id, parsed.data, user);
    refreshBilling(billing.customerId, billing.salesOrderId, billing.id);
    return { ok: true, message: "Billing updated." };
  });
}

export async function voidBillingAction(id: string, reason: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("manage_billing");
    const parsed = voidReasonSchema.safeParse(reason);
    if (!parsed.success) return { fieldErrors: { reason: parsed.error.issues[0]?.message ?? "Give a reason." } };
    const billing = await voidBilling(id, parsed.data, user);
    refreshBilling(billing.customerId, billing.salesOrderId, billing.id);
    return { ok: true, message: "Billing voided." };
  });
}

export async function recordCollectionAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = parseCollectionForm(form);
  if (!parsed.ok) return { values: parsed.values, fieldErrors: parsed.fieldErrors, message: "Fix the fields marked below." };
  const echo: Record<string, string> = {
    customerId: parsed.data.customerId,
    date: parsed.data.date.toISOString().slice(0, 10),
    method: parsed.data.method,
    reference: parsed.data.reference ?? "",
    checkBank: parsed.data.checkBank ?? "",
    checkDate: parsed.data.checkDate ? parsed.data.checkDate.toISOString().slice(0, 10) : "",
    receiptNo: parsed.data.receiptNo ?? "",
    amountReceived: parsed.data.amountReceived,
    notes: parsed.data.notes ?? "",
  };
  let goTo: string | null = null;
  const result = await runAction(async () => {
    const user = await requireActionPermission("manage_billing");
    const { files, error } = await formFiles(form);
    if (error) return { values: echo, fieldErrors: { files: error } };
    const collection = await recordCollection(parsed.data, user, files);
    refreshBilling(collection.customerId, null, null);
    revalidatePath(`/billing/collections/${collection.id}`);
    goTo = `/billing/collections/${collection.id}`;
    return { ok: true };
  }, echo);
  if (goTo) redirect(goTo);
  return result;
}

export async function voidCollectionAction(id: string, reason: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("manage_billing");
    const parsed = voidReasonSchema.safeParse(reason);
    if (!parsed.success) return { fieldErrors: { reason: parsed.error.issues[0]?.message ?? "Give a reason." } };
    const collection = await voidCollection(id, parsed.data, user);
    refreshBilling(collection.customerId, null, null);
    revalidatePath(`/billing/collections/${id}`);
    return { ok: true, message: "Collection voided." };
  });
}

export async function applyCreditAction(_prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  const collectionIds = form.getAll("creditCollectionId").map(String);
  const allocations = collectionIds.map((collectionId, i) => ({
    collectionId,
    billingId: String(form.getAll("creditBillingId")[i] ?? ""),
    cashApplied: String(form.getAll("creditCash")[i] ?? "0"),
    withholdingApplied: String(form.getAll("creditWithholding")[i] ?? "0"),
    withholdingRate: String(form.getAll("creditRate")[i] ?? "") || null,
    atcCode: String(form.getAll("creditAtc")[i] ?? "") || null,
  })).filter((a) => a.collectionId && a.billingId && Number(a.cashApplied) + Number(a.withholdingApplied) > 0);

  const parsed = applyCreditInputSchema.safeParse({
    customerId: str(form, "customerId"),
    allocations,
  });
  if (!parsed.success) return { values, fieldErrors: zodFieldErrors(parsed.error), message: "Fix the fields marked below." };

  return runAction(async () => {
    const user = await requireActionPermission("manage_billing");
    await applyCustomerCredit(parsed.data, user);
    refreshBilling(parsed.data.customerId, null, null);
    return { ok: true, message: "Credit applied." };
  }, values);
}

export async function mark2307ReceivedAction(id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  const parsed = mark2307ReceivedSchema.safeParse({
    receivedAt: str(form, "receivedAt"),
    notes: str(form, "notes"),
  });
  if (!parsed.success) return { values, fieldErrors: zodFieldErrors(parsed.error), message: "Fix the fields marked below." };
  return runAction(async () => {
    const user = await requireActionPermission("manage_billing");
    const { files, error } = await formFiles(form);
    if (error) return { values, fieldErrors: { files: error } };
    await mark2307Received(id, parsed.data, user, files);
    revalidatePath("/billing/2307");
    revalidatePath("/billing", "layout");
    return { ok: true, message: "2307 marked received." };
  }, values);
}
