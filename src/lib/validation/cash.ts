import { z } from "zod";
import { CASH_ACCOUNT_TYPES } from "../cash/labels";

const moneyStr = z
  .string()
  .trim()
  .regex(/^\d{1,13}(\.\d{1,2})?$/, "Enter an amount with up to 2 decimals.");

const optionalMoney = z
  .string()
  .trim()
  .transform((v) => (v === "" ? "0" : v))
  .pipe(moneyStr);

const ymd = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.")
  .transform((s) => new Date(`${s}T00:00:00.000Z`));

const last4 = z
  .string()
  .trim()
  .transform((v) => v || null)
  .pipe(
    z.union([
      z.null(),
      z
        .string()
        .regex(/^\d{4}$/, "Enter the last 4 digits only (never the full account number)."),
    ]),
  );

export const cashAccountInputSchema = z
  .object({
    name: z.string().trim().min(1, "Give this account a name.").max(120),
    type: z.enum(CASH_ACCOUNT_TYPES, { message: "Pick an account type." }),
    bankName: z
      .string()
      .trim()
      .max(120)
      .transform((v) => v || null),
    accountHintLast4: last4,
    openingBalance: moneyStr,
    openingDate: ymd,
    active: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.type === "BANK" && !v.bankName) {
      ctx.addIssue({ code: "custom", message: "Enter the bank name (e.g. UnionBank).", path: ["bankName"] });
    }
  });

export type CashAccountInput = z.infer<typeof cashAccountInputSchema>;

export const expenseInputSchema = z
  .object({
    date: ymd,
    supplierId: z
      .string()
      .trim()
      .transform((v) => v || null),
    payeeText: z
      .string()
      .trim()
      .max(191)
      .transform((v) => v || null),
    categoryId: z.string().min(1, "Pick a category."),
    amount: moneyStr,
    withholdingApplied: optionalMoney,
    cashAccountId: z.string().min(1, "Pick which account paid this."),
    receiptNo: z
      .string()
      .trim()
      .max(64)
      .transform((v) => v || null),
    notes: z
      .string()
      .trim()
      .max(5000)
      .transform((v) => v || null),
  })
  .superRefine((v, ctx) => {
    if (!v.supplierId && !v.payeeText) {
      ctx.addIssue({
        code: "custom",
        message: "Enter who was paid — pick a supplier or type a name.",
        path: ["payeeText"],
      });
    }
  });

export type ExpenseInput = z.infer<typeof expenseInputSchema>;

export const cashTransferInputSchema = z
  .object({
    date: ymd,
    fromAccountId: z.string().min(1, "Pick the account money left."),
    toAccountId: z.string().min(1, "Pick the account money went to."),
    amount: moneyStr,
    notes: z
      .string()
      .trim()
      .max(5000)
      .transform((v) => v || null),
  })
  .superRefine((v, ctx) => {
    if (v.fromAccountId && v.toAccountId && v.fromAccountId === v.toAccountId) {
      ctx.addIssue({
        code: "custom",
        message: "Pick two different accounts. To correct a balance, void the wrong entry instead.",
        path: ["toAccountId"],
      });
    }
  });

export type CashTransferInput = z.infer<typeof cashTransferInputSchema>;

export function parseCashAccountForm(
  form: FormData,
): { ok: true; data: CashAccountInput } | { ok: false; fieldErrors: Record<string, string>; values: Record<string, string> } {
  const values: Record<string, string> = {
    name: String(form.get("name") ?? ""),
    type: String(form.get("type") ?? ""),
    bankName: String(form.get("bankName") ?? ""),
    accountHintLast4: String(form.get("accountHintLast4") ?? ""),
    openingBalance: String(form.get("openingBalance") ?? ""),
    openingDate: String(form.get("openingDate") ?? ""),
    active: form.get("active") ? "on" : "",
  };
  const parsed = cashAccountInputSchema.safeParse({
    ...values,
    active: values.active === "on" || values.active === "true" || form.get("active") === "true",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[i.path.join(".") || "_"] ??= i.message;
    return { ok: false, fieldErrors, values };
  }
  return { ok: true, data: parsed.data };
}

export function parseExpenseForm(
  form: FormData,
): { ok: true; data: ExpenseInput } | { ok: false; fieldErrors: Record<string, string>; values: Record<string, string> } {
  const values: Record<string, string> = {
    date: String(form.get("date") ?? ""),
    supplierId: String(form.get("supplierId") ?? ""),
    payeeText: String(form.get("payeeText") ?? ""),
    categoryId: String(form.get("categoryId") ?? ""),
    amount: String(form.get("amount") ?? ""),
    withholdingApplied: String(form.get("withholdingApplied") ?? ""),
    cashAccountId: String(form.get("cashAccountId") ?? ""),
    receiptNo: String(form.get("receiptNo") ?? ""),
    notes: String(form.get("notes") ?? ""),
  };
  const parsed = expenseInputSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[i.path.join(".") || "_"] ??= i.message;
    return { ok: false, fieldErrors, values };
  }
  return { ok: true, data: parsed.data };
}

export function parseCashTransferForm(
  form: FormData,
): { ok: true; data: CashTransferInput } | { ok: false; fieldErrors: Record<string, string>; values: Record<string, string> } {
  const values: Record<string, string> = {
    date: String(form.get("date") ?? ""),
    fromAccountId: String(form.get("fromAccountId") ?? ""),
    toAccountId: String(form.get("toAccountId") ?? ""),
    amount: String(form.get("amount") ?? ""),
    notes: String(form.get("notes") ?? ""),
  };
  const parsed = cashTransferInputSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[i.path.join(".") || "_"] ??= i.message;
    return { ok: false, fieldErrors, values };
  }
  return { ok: true, data: parsed.data };
}
