"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { assertCashEnabled } from "@/lib/cash/features";
import { createCashAccount, updateCashAccount } from "@/lib/services/cash-accounts";
import { recordExpense, voidExpense } from "@/lib/services/expenses";
import { recordCashTransfer, voidCashTransfer } from "@/lib/services/cash-transfers";
import { parseCashAccountForm, parseCashTransferForm, parseExpenseForm } from "@/lib/validation/cash";
import { voidReasonSchema } from "@/lib/validation/quotes";
import { type FormState } from "@/lib/validation/forms";
import { formFiles } from "@/lib/form-files";

async function assertFeatureOn() {
  await assertCashEnabled();
}

function refreshCash(paths: string[] = []) {
  revalidatePath("/cash", "layout");
  revalidatePath("/");
  for (const p of paths) revalidatePath(p);
}

export async function createCashAccountAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = parseCashAccountForm(form);
  if (!parsed.ok) return { values: parsed.values, fieldErrors: parsed.fieldErrors, message: "Fix the fields marked below." };
  const echo: Record<string, string> = {
    name: parsed.data.name,
    type: parsed.data.type,
    bankName: parsed.data.bankName ?? "",
    accountHintLast4: parsed.data.accountHintLast4 ?? "",
    openingBalance: parsed.data.openingBalance,
    openingDate: parsed.data.openingDate.toISOString().slice(0, 10),
    active: parsed.data.active ? "on" : "",
  };
  let goTo: string | null = null;
  const result = await runAction(async () => {
    await assertFeatureOn();
    const user = await requireActionPermission("manage_cash");
    const row = await createCashAccount(parsed.data, user);
    refreshCash([`/cash/accounts/${row.id}`]);
    goTo = `/cash/accounts/${row.id}`;
    return { ok: true };
  }, echo);
  if (goTo) redirect(goTo);
  return result;
}

export async function updateCashAccountAction(id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const parsed = parseCashAccountForm(form);
  if (!parsed.ok) return { values: parsed.values, fieldErrors: parsed.fieldErrors, message: "Fix the fields marked below." };
  const echo: Record<string, string> = {
    name: parsed.data.name,
    type: parsed.data.type,
    bankName: parsed.data.bankName ?? "",
    accountHintLast4: parsed.data.accountHintLast4 ?? "",
    openingBalance: parsed.data.openingBalance,
    openingDate: parsed.data.openingDate.toISOString().slice(0, 10),
    active: parsed.data.active ? "on" : "",
  };
  return runAction(async () => {
    await assertFeatureOn();
    const user = await requireActionPermission("manage_cash");
    await updateCashAccount(id, parsed.data, user);
    refreshCash([`/cash/accounts/${id}`, "/cash/ledger"]);
    return { ok: true, message: "Account saved." };
  }, echo);
}

export async function recordExpenseAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = parseExpenseForm(form);
  if (!parsed.ok) return { values: parsed.values, fieldErrors: parsed.fieldErrors, message: "Fix the fields marked below." };
  const echo: Record<string, string> = {
    date: parsed.data.date.toISOString().slice(0, 10),
    supplierId: parsed.data.supplierId ?? "",
    payeeText: parsed.data.payeeText ?? "",
    categoryId: parsed.data.categoryId,
    amount: parsed.data.amount,
    withholdingApplied: parsed.data.withholdingApplied,
    cashAccountId: parsed.data.cashAccountId,
    receiptNo: parsed.data.receiptNo ?? "",
    notes: parsed.data.notes ?? "",
  };
  let goTo: string | null = null;
  const result = await runAction(async () => {
    await assertFeatureOn();
    const user = await requireActionPermission("manage_cash");
    const { files, error } = await formFiles(form);
    if (error) return { values: echo, fieldErrors: { files: error } };
    const expense = await recordExpense(parsed.data, user, files);
    refreshCash([`/cash/expenses/${expense.id}`, `/cash/accounts/${expense.cashAccountId}`, "/cash/ledger"]);
    goTo = `/cash/expenses/${expense.id}`;
    return { ok: true };
  }, echo);
  if (goTo) redirect(goTo);
  return result;
}

export async function voidExpenseAction(id: string, reason: string): Promise<FormState> {
  return runAction(async () => {
    await assertFeatureOn();
    const user = await requireActionPermission("manage_cash");
    const parsed = voidReasonSchema.safeParse(reason);
    if (!parsed.success) return { fieldErrors: { reason: parsed.error.issues[0]?.message ?? "Give a reason." } };
    const expense = await voidExpense(id, parsed.data, user);
    refreshCash([`/cash/expenses/${id}`, `/cash/accounts/${expense.cashAccountId}`, "/cash/ledger"]);
    return { ok: true, message: "Expense voided." };
  });
}

export async function recordCashTransferAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = parseCashTransferForm(form);
  if (!parsed.ok) return { values: parsed.values, fieldErrors: parsed.fieldErrors, message: "Fix the fields marked below." };
  const echo: Record<string, string> = {
    date: parsed.data.date.toISOString().slice(0, 10),
    fromAccountId: parsed.data.fromAccountId,
    toAccountId: parsed.data.toAccountId,
    amount: parsed.data.amount,
    notes: parsed.data.notes ?? "",
  };
  let goTo: string | null = null;
  const result = await runAction(async () => {
    await assertFeatureOn();
    const user = await requireActionPermission("manage_cash");
    const transfer = await recordCashTransfer(parsed.data, user);
    refreshCash([
      `/cash/transfers/${transfer.id}`,
      `/cash/accounts/${transfer.fromAccountId}`,
      `/cash/accounts/${transfer.toAccountId}`,
      "/cash/ledger",
    ]);
    goTo = `/cash/transfers/${transfer.id}`;
    return { ok: true };
  }, echo);
  if (goTo) redirect(goTo);
  return result;
}

export async function voidCashTransferAction(id: string, reason: string): Promise<FormState> {
  return runAction(async () => {
    await assertFeatureOn();
    const user = await requireActionPermission("manage_cash");
    const parsed = voidReasonSchema.safeParse(reason);
    if (!parsed.success) return { fieldErrors: { reason: parsed.error.issues[0]?.message ?? "Give a reason." } };
    const transfer = await voidCashTransfer(id, parsed.data, user);
    refreshCash([
      `/cash/transfers/${id}`,
      `/cash/accounts/${transfer.fromAccountId}`,
      `/cash/accounts/${transfer.toAccountId}`,
      "/cash/ledger",
    ]);
    return { ok: true, message: "Transfer voided." };
  });
}
