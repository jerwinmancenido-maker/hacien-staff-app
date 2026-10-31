import { z } from "zod";

const moneyStr = z
  .string()
  .trim()
  .regex(/^\d{1,13}(\.\d{1,2})?$/, "Enter an amount with up to 2 decimals.");

const optionalMoney = z
  .string()
  .trim()
  .transform((v) => (v === "" ? "0" : v))
  .pipe(moneyStr);

/** Rate as fraction (0.01 = 1%) or percent (1 / 1.00); stored as fraction with 4 dp. */
const rateStr = z
  .string()
  .trim()
  .transform((v) => (v === "" ? "0" : v))
  .refine((v) => /^\d{1,2}(\.\d{1,4})?$/.test(v), "Enter a rate with up to 4 decimals.")
  .transform((v) => {
    const n = Number(v);
    // Values > 1 are treated as percent (e.g. 1 → 0.01, 2.5 → 0.025).
    if (n > 1) return (n / 100).toFixed(4);
    return Number(v).toFixed(4);
  });

const ymd = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.")
  .transform((s) => new Date(`${s}T00:00:00.000Z`));

export const PAYMENT_METHODS = ["BANK_TRANSFER", "CHECK", "CASH", "E_WALLET"] as const;
export type PaymentMethodInput = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodInput, string> = {
  BANK_TRANSFER: "Bank transfer",
  CHECK: "Check",
  CASH: "Cash",
  E_WALLET: "E-wallet",
};

export const paymentAllocationRowSchema = z.object({
  supplierBillId: z.string().min(1),
  cashApplied: optionalMoney,
  withholdingApplied: optionalMoney,
  withholdingRate: rateStr,
  atcCode: z
    .string()
    .trim()
    .max(20)
    .transform((v) => v || null)
    .nullable()
    .optional(),
});

export const supplierPaymentInputSchema = z
  .object({
    supplierId: z.string().min(1, "Supplier is required."),
    date: ymd,
    method: z.enum(PAYMENT_METHODS, { message: "Pick a payment method." }),
    reference: z
      .string()
      .trim()
      .max(100)
      .transform((v) => v || null),
    checkBank: z
      .string()
      .trim()
      .max(100)
      .transform((v) => v || null),
    checkDate: z
      .string()
      .trim()
      .transform((v) => (v ? v : null))
      .pipe(z.union([ymd, z.null()])),
    amountPaid: moneyStr,
    // Optional cash account (Part 7a). Blank = not assigned.
    cashAccountId: z
      .string()
      .trim()
      .transform((v) => v || null)
      .nullable()
      .optional(),
    notes: z
      .string()
      .trim()
      .max(5000)
      .transform((v) => v || null),
    allocations: z.array(paymentAllocationRowSchema).min(1, "Allocate to at least one bill."),
  })
  .superRefine((v, ctx) => {
    if (v.method === "CHECK") {
      if (!v.reference) ctx.addIssue({ code: "custom", message: "Check number is required.", path: ["reference"] });
      if (!v.checkBank) ctx.addIssue({ code: "custom", message: "Bank is required for checks.", path: ["checkBank"] });
    }
    if ((v.method === "BANK_TRANSFER" || v.method === "E_WALLET") && !v.reference) {
      ctx.addIssue({ code: "custom", message: "Reference number is required.", path: ["reference"] });
    }
  });

export type SupplierPaymentInput = z.infer<typeof supplierPaymentInputSchema>;
export type PaymentAllocationRowInput = z.infer<typeof paymentAllocationRowSchema>;

export const markSupplier2307IssuedSchema = z.object({
  issuedAt: ymd,
  notes: z
    .string()
    .trim()
    .max(5000)
    .transform((v) => v || null),
});

export type MarkSupplier2307IssuedInput = z.infer<typeof markSupplier2307IssuedSchema>;

export function parseSupplierPaymentForm(
  form: FormData,
): { ok: true; data: SupplierPaymentInput } | { ok: false; fieldErrors: Record<string, string>; values: Record<string, string> } {
  const billIds = form.getAll("allocBillId").map(String);
  const allocations = billIds
    .map((supplierBillId, i) => ({
      supplierBillId,
      cashApplied: String(form.getAll("allocCash")[i] ?? "0"),
      withholdingApplied: String(form.getAll("allocWithholding")[i] ?? "0"),
      withholdingRate: String(form.getAll("allocRate")[i] ?? "0") || "0",
      atcCode: String(form.getAll("allocAtc")[i] ?? "") || null,
    }))
    .filter((a) => a.supplierBillId && (Number(a.cashApplied) > 0 || Number(a.withholdingApplied) > 0));

  const values: Record<string, string> = {
    supplierId: String(form.get("supplierId") ?? ""),
    date: String(form.get("date") ?? ""),
    method: String(form.get("method") ?? ""),
    reference: String(form.get("reference") ?? ""),
    checkBank: String(form.get("checkBank") ?? ""),
    checkDate: String(form.get("checkDate") ?? ""),
    amountPaid: String(form.get("amountPaid") ?? ""),
    cashAccountId: String(form.get("cashAccountId") ?? ""),
    notes: String(form.get("notes") ?? ""),
  };
  const parsed = supplierPaymentInputSchema.safeParse({ ...values, allocations });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[i.path.join(".") || "_"] ??= i.message;
    return { ok: false, fieldErrors, values };
  }
  return { ok: true, data: parsed.data };
}
