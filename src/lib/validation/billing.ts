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

const ymd = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.")
  .transform((s) => new Date(`${s}T00:00:00.000Z`));

export const COLLECTION_METHODS = ["CASH", "CHECK", "BANK_TRANSFER", "GCASH"] as const;
export type CollectionMethodInput = (typeof COLLECTION_METHODS)[number];

export const COLLECTION_METHOD_LABELS: Record<CollectionMethodInput, string> = {
  CASH: "Cash",
  CHECK: "Check",
  BANK_TRANSFER: "Bank transfer",
  GCASH: "GCash",
};

export const billingInputSchema = z.object({
  salesOrderId: z.string().min(1, "Sales order is required."),
  amount: moneyStr,
  invoiceNo: z.coerce.number().int("Enter a whole number.").min(1, "Enter a booklet invoice number."),
  invoiceDate: ymd,
  dueDate: ymd,
  notes: z
    .string()
    .trim()
    .max(5000)
    .transform((v) => v || null),
});

export type BillingInput = z.infer<typeof billingInputSchema>;

/** One ATC code amount on a collection allocation (2307 line). */
export const withholdingCodeRowSchema = z.object({
  rate: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,4})?$/, "Enter a rate fraction like 0.0100.")
    .transform((v) => Number(v).toFixed(4)),
  atcCode: z
    .string()
    .trim()
    .max(20)
    .transform((v) => (v ? v.toUpperCase() : null))
    .nullable(),
  amount: moneyStr,
});

export type WithholdingCodeRowInput = z.infer<typeof withholdingCodeRowSchema>;

export const allocationRowSchema = z.object({
  billingId: z.string().min(1),
  cashApplied: optionalMoney,
  withholdingApplied: optionalMoney,
  /** Optional override; blank = use SO / rate table default. */
  withholdingRate: z
    .string()
    .trim()
    .transform((v) => v || null)
    .nullable()
    .optional(),
  atcCode: z
    .string()
    .trim()
    .max(20)
    .transform((v) => v || null)
    .nullable()
    .optional(),
  /** Per-ATC 2307 lines. When set, amounts should sum to withholdingApplied. */
  codes: z.array(withholdingCodeRowSchema).optional(),
});

export const collectionInputSchema = z
  .object({
    customerId: z.string().min(1, "Customer is required."),
    date: ymd,
    method: z.enum(COLLECTION_METHODS, { message: "Pick a payment method." }),
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
    receiptNo: z
      .string()
      .trim()
      .max(64)
      .transform((v) => v || null),
    amountReceived: moneyStr,
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
    allocations: z.array(allocationRowSchema).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.method === "CHECK") {
      if (!v.reference) ctx.addIssue({ code: "custom", message: "Check number is required.", path: ["reference"] });
      if (!v.checkBank) ctx.addIssue({ code: "custom", message: "Bank is required for checks.", path: ["checkBank"] });
    }
    if ((v.method === "BANK_TRANSFER" || v.method === "GCASH") && !v.reference) {
      ctx.addIssue({ code: "custom", message: "Reference number is required.", path: ["reference"] });
    }
  });

export type CollectionInput = z.infer<typeof collectionInputSchema>;
export type AllocationRowInput = z.infer<typeof allocationRowSchema>;

/** Apply unapplied customer credit from existing collections onto open billings. */
export const applyCreditInputSchema = z.object({
  customerId: z.string().min(1),
  allocations: z
    .array(
      z
        .object({
          collectionId: z.string().min(1),
          billingId: z.string().min(1),
          cashApplied: moneyStr,
          withholdingApplied: optionalMoney,
          withholdingRate: z
            .string()
            .trim()
            .transform((v) => v || null)
            .nullable()
            .optional(),
          atcCode: z
            .string()
            .trim()
            .max(20)
            .transform((v) => v || null)
            .nullable()
            .optional(),
        })
        .superRefine((row, ctx) => {
          // Credit is cash-only; any withholding would shrink AR without consuming credit.
          const wh = (row.withholdingApplied ?? "0").trim();
          if (!/^0+(\.0+)?$/.test(wh)) {
            ctx.addIssue({
              code: "custom",
              message:
                "Withholding can't be applied from customer credit. Record 2307 when you collect the payment, then apply cash credit only.",
              path: ["withholdingApplied"],
            });
          }
        }),
    )
    .min(1, "Allocate at least one amount."),
});

export type ApplyCreditInput = z.infer<typeof applyCreditInputSchema>;

/** Simple UI shape: apply this much credit onto one open billing (FIFO across credit sources). */
export const applyCreditSimpleSchema = z.object({
  customerId: z.string().min(1, "Customer is required."),
  billingId: z.string().min(1, "Pick an open billing."),
  amount: moneyStr,
});

export type ApplyCreditSimpleInput = z.infer<typeof applyCreditSimpleSchema>;

export const mark2307ReceivedSchema = z.object({
  receivedAt: ymd,
  notes: z
    .string()
    .trim()
    .max(5000)
    .transform((v) => v || null),
});

export type Mark2307ReceivedInput = z.infer<typeof mark2307ReceivedSchema>;

export function parseBillingForm(form: FormData): { ok: true; data: BillingInput } | { ok: false; fieldErrors: Record<string, string>; values: Record<string, string> } {
  const values = {
    salesOrderId: String(form.get("salesOrderId") ?? ""),
    amount: String(form.get("amount") ?? ""),
    invoiceNo: String(form.get("invoiceNo") ?? ""),
    invoiceDate: String(form.get("invoiceDate") ?? ""),
    dueDate: String(form.get("dueDate") ?? ""),
    notes: String(form.get("notes") ?? ""),
  };
  const parsed = billingInputSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[i.path.join(".") || "_"] ??= i.message;
    return { ok: false, fieldErrors, values };
  }
  return { ok: true, data: parsed.data };
}

export function parseCollectionForm(form: FormData): { ok: true; data: CollectionInput } | { ok: false; fieldErrors: Record<string, string>; values: Record<string, string> } {
  const allocationBillingIds = form.getAll("allocBillingId").map(String);
  const codeBillingIds = form.getAll("allocCodeBillingId").map(String);
  const codeRates = form.getAll("allocCodeRate").map(String);
  const codeAtcs = form.getAll("allocCodeAtc").map(String);
  const codeAmounts = form.getAll("allocCodeAmount").map(String);
  const codesByBilling = new Map<string, { rate: string; atcCode: string | null; amount: string }[]>();
  for (let i = 0; i < codeBillingIds.length; i++) {
    const billingId = codeBillingIds[i]!;
    const amount = (codeAmounts[i] ?? "").trim();
    if (!billingId || !amount || Number(amount) <= 0) continue;
    const list = codesByBilling.get(billingId) ?? [];
    list.push({
      rate: (codeRates[i] ?? "").trim() || "0.0000",
      atcCode: (codeAtcs[i] ?? "").trim() || null,
      amount,
    });
    codesByBilling.set(billingId, list);
  }

  const allocations = allocationBillingIds
    .map((billingId, i) => {
      const codes = codesByBilling.get(billingId);
      const withholdingApplied = String(form.getAll("allocWithholding")[i] ?? "0");
      return {
        billingId,
        cashApplied: String(form.getAll("allocCash")[i] ?? "0"),
        withholdingApplied,
        withholdingRate: String(form.getAll("allocRate")[i] ?? "") || null,
        atcCode: String(form.getAll("allocAtc")[i] ?? "") || null,
        ...(codes?.length ? { codes } : {}),
      };
    })
    .filter((a) => a.billingId && (Number(a.cashApplied) > 0 || Number(a.withholdingApplied) > 0));

  const values: Record<string, string> = {
    customerId: String(form.get("customerId") ?? ""),
    date: String(form.get("date") ?? ""),
    method: String(form.get("method") ?? ""),
    reference: String(form.get("reference") ?? ""),
    checkBank: String(form.get("checkBank") ?? ""),
    checkDate: String(form.get("checkDate") ?? ""),
    receiptNo: String(form.get("receiptNo") ?? ""),
    amountReceived: String(form.get("amountReceived") ?? ""),
    cashAccountId: String(form.get("cashAccountId") ?? ""),
    notes: String(form.get("notes") ?? ""),
  };
  const parsed = collectionInputSchema.safeParse({ ...values, allocations });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[i.path.join(".") || "_"] ??= i.message;
    return { ok: false, fieldErrors, values };
  }
  return { ok: true, data: parsed.data };
}
