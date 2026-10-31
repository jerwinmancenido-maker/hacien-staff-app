"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { recordBilling, updateBilling, voidBilling } from "@/lib/services/billings";
import { applyCustomerCredit, mark2307Received, recordCollection, voidCollection } from "@/lib/services/collections";
import { planCreditApplication } from "@/lib/billing/allocations";
import { unappliedCash } from "@/lib/billing/status";
import { money } from "@/lib/documents/common";
import { db } from "@/lib/db";
import { fromScaled, toScaled } from "@/lib/quotes/calc";
import {
  applyCreditInputSchema,
  applyCreditSimpleSchema,
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
    cashAccountId: parsed.data.cashAccountId ?? "",
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

  // Detailed rows (tests / advanced) or simple UI: customerId + billingId + amount.
  if (collectionIds.length > 0) {
    const allocations = collectionIds
      .map((collectionId, i) => ({
        collectionId,
        billingId: String(form.getAll("creditBillingId")[i] ?? ""),
        cashApplied: String(form.getAll("creditCash")[i] ?? "0"),
        withholdingApplied: String(form.getAll("creditWithholding")[i] ?? "0"),
        withholdingRate: String(form.getAll("creditRate")[i] ?? "") || null,
        atcCode: String(form.getAll("creditAtc")[i] ?? "") || null,
      }))
      .filter((a) => a.collectionId && a.billingId && a.cashApplied !== "" && a.cashApplied !== "0" && a.cashApplied !== "0.00");

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

  const simple = applyCreditSimpleSchema.safeParse({
    customerId: str(form, "customerId"),
    billingId: str(form, "billingId"),
    amount: str(form, "amount"),
  });
  if (!simple.success) return { values, fieldErrors: zodFieldErrors(simple.error), message: "Fix the fields marked below." };

  return runAction(async () => {
    const user = await requireActionPermission("manage_billing");
    const { customerId, billingId, amount } = simple.data;
    if (toScaled(amount, 2) <= 0n) {
      return {
        values,
        fieldErrors: { amount: "Enter an amount greater than 0." },
        message: "Enter how much credit to apply.",
      };
    }

    const collections = await db.collection.findMany({
      where: { customerId, status: "POSTED" },
      include: { allocations: true },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    const sources = collections
      .map((c) => ({
        collectionId: c.id,
        unappliedCredit: unappliedCash(
          money(c.amountReceived),
          c.allocations.map((a) => money(a.cashApplied)),
        ),
      }))
      .filter((s) => toScaled(s.unappliedCredit, 2) > 0n);

    const totalCredit = fromScaled(
      sources.reduce((acc, s) => acc + toScaled(s.unappliedCredit, 2), 0n),
      2,
    );
    if (toScaled(amount, 2) > toScaled(totalCredit, 2)) {
      return {
        values,
        fieldErrors: {
          amount: `Only ₱${totalCredit} credit is available. Lower the amount or record a collection first.`,
        },
        message: "Not enough customer credit for that amount.",
      };
    }

    let planned;
    try {
      planned = planCreditApplication(amount, sources, billingId);
    } catch (err) {
      return {
        values,
        fieldErrors: { amount: err instanceof Error ? err.message : "Couldn't plan the credit apply." },
        message: "Fix the amount and try again.",
      };
    }
    if (planned.length === 0) {
      return {
        values,
        fieldErrors: { amount: "No unapplied credit to apply. Record a collection first." },
        message: "No customer credit available.",
      };
    }

    await applyCustomerCredit({ customerId, allocations: planned }, user);
    refreshBilling(customerId, null, null);
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
