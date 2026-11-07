import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/format";
import { agingBucket, sumAging } from "@/lib/billing/aging";
import { autoAllocateBillsOldestFirst, validatePaymentAllocations } from "@/lib/payables/allocations";
import { deriveSupplierBillStatus, supplierBillBalance, withholdingFromRate } from "@/lib/payables/status";
import { dealsNavHrefs } from "@/components/Sidebar";
import { visiblePayablesNavTabs } from "@/components/payables/PayablesNav";
import { payablesEnabledFromEnv } from "@/lib/payables/features";
import { payables2307EnabledFromEnv } from "@/lib/payables/issue2307";
import { can, canMaintainSupplierPayment, canVoid, ForbiddenError, roleFlags, type PermissionUser, type Role } from "@/lib/permissions";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import { formatDocNumber } from "@/lib/settings/numbering";
import { computeWeOweRows, weOweDueLabel } from "@/lib/payables/we-owe";
import { supplierPaymentInputSchema, type SupplierPaymentInput } from "@/lib/validation/payables";
import { maskBankAccountNumber } from "@/lib/bank-mask";
import { DocRuleError } from "@/lib/documents/common";
import { recordSupplierPayment } from "@/lib/services/supplier-payments";

const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

function user(roles: Role[]): PermissionUser {
  return { ...roleFlags(roles), active: true, canSeeCosts: false };
}

describe("manage_payables permission", () => {
  it("Admin and Approver only", () => {
    expect(can(user(["ADMIN"]), "manage_payables")).toBe(true);
    expect(can(user(["APPROVER"]), "manage_payables")).toBe(true);
    expect(can(user(["STAFF"]), "manage_payables")).toBe(false);
    expect(can(user(["VIEWER"]), "manage_payables")).toBe(false);
  });
});

describe("feature flag", () => {
  it("defaults off; env overrides", () => {
    expect(payablesEnabledFromEnv({})).toBe(null);
    expect(payablesEnabledFromEnv({ PAYABLES_ENABLED: "true" })).toBe(true);
    expect(payablesEnabledFromEnv({ PAYABLES_ENABLED: "0" })).toBe(false);
    expect(DEFAULT_SETTINGS.features.payablesEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.features.cashEnabled).toBe(false);
  });
});

describe("Payables 2307 (withholding agent) flag", () => {
  it("defaults off; env overrides", () => {
    expect(payables2307EnabledFromEnv({})).toBe(null);
    expect(payables2307EnabledFromEnv({ PAYABLES_2307_ENABLED: "true" })).toBe(true);
    expect(payables2307EnabledFromEnv({ PAYABLES_2307_ENABLED: "0" })).toBe(false);
    expect(DEFAULT_SETTINGS.features.payables2307Enabled).toBe(false);
  });

  it("hides the 2307 tab by default and shows it when the flag is on", () => {
    const off = visiblePayablesNavTabs(false);
    expect(off.map((t) => t.key)).toEqual(["home", "we-owe", "payments", "aging"]);
    expect(off.some((t) => /2307|EWT pending/i.test(t.label))).toBe(false);

    const on = visiblePayablesNavTabs(true);
    expect(on.map((t) => t.key)).toEqual(["home", "we-owe", "payments", "aging", "2307"]);
    expect(on.find((t) => t.key === "2307")?.label).toBe("2307 to issue");
  });

  it("gates markSupplier2307IssuedAction with assertPayables2307Enabled", () => {
    const src = readFileSync(path.join(process.cwd(), "src/app/(app)/payables/actions.ts"), "utf8");
    expect(src).toMatch(/assertPayables2307Enabled/);
    expect(src).toMatch(/markSupplier2307IssuedAction[\s\S]*await assertPayables2307Enabled\(\)/);
  });
});

describe("Payables sidebar gating (PAYABLES_ENABLED)", () => {
  const base = { canSeeCosts: true, canEdit: true, cashEnabled: false };

  it("hides Payables when the flag is off", () => {
    const hrefs = dealsNavHrefs({ ...base, payablesEnabled: false });
    expect(hrefs).not.toContain("/payables");
  });

  it("shows Payables when the flag is on", () => {
    const hrefs = dealsNavHrefs({ ...base, payablesEnabled: true });
    expect(hrefs).toContain("/payables");
  });
});

describe("supplier bill balance & status", () => {
  it("balance and status derivation", () => {
    expect(supplierBillBalance("100.00", { cashApplied: "40.00", withholdingApplied: "10.00" })).toBe("50.00");
    expect(deriveSupplierBillStatus("100.00", { cashApplied: "0", withholdingApplied: "0" })).toBe("RECORDED");
    expect(deriveSupplierBillStatus("100.00", { cashApplied: "40.00", withholdingApplied: "10.00" })).toBe("PARTIALLY_PAID");
    expect(deriveSupplierBillStatus("100.00", { cashApplied: "90.00", withholdingApplied: "10.00" })).toBe("PAID");
  });
  it("withholding math from rate", () => {
    expect(withholdingFromRate("100000.00", "0.0100")).toBe("1000.00");
    expect(withholdingFromRate("100000.00", "0.0200")).toBe("2000.00");
  });
});

describe("payment allocation validation (exact cash match)", () => {
  const bills = [
    { id: "b1", amount: "1000.00", alreadyCash: "0", alreadyWithholding: "0" },
    { id: "b2", amount: "500.00", alreadyCash: "0", alreadyWithholding: "0" },
  ];

  it("accepts exact cash allocation", () => {
    expect(
      validatePaymentAllocations(
        "1000.00",
        [{ supplierBillId: "b1", cashApplied: "1000.00", withholdingApplied: "0", withholdingRate: "0", atcCode: null }],
        bills,
      ),
    ).toBeNull();
  });

  it("accepts cash + EWT that clears a bill", () => {
    expect(
      validatePaymentAllocations(
        "990.00",
        [
          {
            supplierBillId: "b1",
            cashApplied: "990.00",
            withholdingApplied: "10.00",
            withholdingRate: "0.0100",
            atcCode: "WC010",
          },
        ],
        bills,
      ),
    ).toBeNull();
  });

  it("requires sum(cash) === amountPaid exactly (EWT is separate, not float)", () => {
    // cash 99.99 + EWT 0.01 clears 100; amountPaid must be cash only
    expect(
      validatePaymentAllocations(
        "99.99",
        [
          {
            supplierBillId: "b1",
            cashApplied: "99.99",
            withholdingApplied: "0.01",
            withholdingRate: "0.0001",
            atcCode: "WC010",
          },
        ],
        [{ id: "b1", amount: "100.00", alreadyCash: "0", alreadyWithholding: "0" }],
      ),
    ).toBeNull();
    // Off-by-one cent on cash must fail (scaled bigint, not float)
    expect(
      validatePaymentAllocations(
        "100.00",
        [
          {
            supplierBillId: "b1",
            cashApplied: "99.99",
            withholdingApplied: "0.01",
            withholdingRate: "0.0001",
            atcCode: "WC010",
          },
        ],
        [{ id: "b1", amount: "100.00", alreadyCash: "0", alreadyWithholding: "0" }],
      )?.message,
    ).toMatch(/still left to allocate/i);
  });

  it("rejects over-allocation (cash exceeds amount paid)", () => {
    const issue = validatePaymentAllocations(
      "500.00",
      [{ supplierBillId: "b1", cashApplied: "600.00", withholdingApplied: "0", withholdingRate: "0", atcCode: null }],
      bills,
    );
    expect(issue?.message).toMatch(/too much on bills|Left to allocate/i);
  });

  it("rejects under-allocation (cash less than amount paid)", () => {
    const issue = validatePaymentAllocations(
      "1000.00",
      [{ supplierBillId: "b1", cashApplied: "800.00", withholdingApplied: "0", withholdingRate: "0", atcCode: null }],
      bills,
    );
    expect(issue?.message).toMatch(/still left to allocate/i);
  });

  it("rejects allocation exceeding bill remaining balance", () => {
    const partial = [{ id: "b1", amount: "1000.00", alreadyCash: "900.00", alreadyWithholding: "0" }];
    const issue = validatePaymentAllocations(
      "200.00",
      [{ supplierBillId: "b1", cashApplied: "200.00", withholdingApplied: "0", withholdingRate: "0", atcCode: null }],
      partial,
    );
    expect(issue?.message).toMatch(/only has ₱|Lower the cash/i);
  });

  it("rejects empty allocations", () => {
    expect(validatePaymentAllocations("100.00", [], bills)?.message).toMatch(/at least one unpaid bill/i);
  });

  it("auto-allocates oldest first", () => {
    const open = [
      { id: "b2", amount: "500.00", alreadyCash: "0", alreadyWithholding: "0", dueDate: d("2026-02-01") },
      { id: "b1", amount: "1000.00", alreadyCash: "0", alreadyWithholding: "0", dueDate: d("2026-01-01") },
    ];
    const alloc = autoAllocateBillsOldestFirst("1200.00", open);
    expect(alloc).toHaveLength(2);
    expect(alloc[0]!.supplierBillId).toBe("b1");
    expect(alloc[0]!.cashApplied).toBe("1000.00");
    expect(alloc[1]!.cashApplied).toBe("200.00");
  });
});

describe("AP aging buckets reuse AR math", () => {
  const today = d("2026-06-15");
  it("bucket boundaries", () => {
    expect(agingBucket(today, today)).toBe("current");
    expect(agingBucket(addDays(today, -1), today)).toBe("d1_30");
    expect(agingBucket(addDays(today, -31), today)).toBe("d31_60");
    expect(agingBucket(addDays(today, -61), today)).toBe("d61_90");
    expect(agingBucket(addDays(today, -91), today)).toBe("d90_plus");
  });
  it("sumAging", () => {
    const a = sumAging(
      [
        { dueDate: today, balance: "100.00" },
        { dueDate: addDays(today, -10), balance: "50.00" },
      ],
      today,
    );
    expect(a.current).toBe("100.00");
    expect(a.d1_30).toBe("50.00");
    expect(a.total).toBe("150.00");
  });
});

describe("supplier payment numbering default", () => {
  it("PAY-YYYY-####", () => {
    const f = DEFAULT_SETTINGS.numbering.supplierPayment;
    expect(formatDocNumber(f, 2026, 1)).toBe("PAY-2026-0001");
  });
});

describe("Q06 S-41: Supplier payment role rules", () => {
  it("recording supplier payments is Admin-only", () => {
    expect(canMaintainSupplierPayment(user(["ADMIN"]))).toBe(true);
    expect(canMaintainSupplierPayment(user(["APPROVER"]))).toBe(false);
    expect(canMaintainSupplierPayment(user(["STAFF"]))).toBe(false);
    expect(canMaintainSupplierPayment(user(["VIEWER"]))).toBe(false);
    expect(canMaintainSupplierPayment({ ...user(["ADMIN"]), active: false })).toBe(false);
  });

  it("voiding supplier payments is Admin or Approver only", () => {
    expect(canVoid(user(["ADMIN"]))).toBe(true);
    expect(canVoid(user(["APPROVER"]))).toBe(true);
    expect(canVoid(user(["STAFF"]))).toBe(false);
    expect(canVoid(user(["VIEWER"]))).toBe(false);
    expect(canVoid({ ...user(["ADMIN"]), active: false })).toBe(false);
    expect(canVoid({ ...user(["APPROVER"]), active: false })).toBe(false);
  });
});

const proof = [{ name: "proof.png", size: 8, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }];

function paymentInput(over: Partial<SupplierPaymentInput> = {}): SupplierPaymentInput {
  return {
    supplierId: "sup-1",
    date: d("2026-11-02"),
    method: "BANK_TRANSFER",
    reference: "UB-TXN-987654",
    amountPaid: "25000.00",
    allocations: [
      { supplierBillId: "b1", cashApplied: "25000.00", withholdingApplied: "0.00", withholdingRate: "0.0000", atcCode: null },
    ],
    ...over,
  };
}

describe("Q06 S-41: Payment validation messages", () => {
  it("requires UnionBank reference when method is bank transfer", () => {
    const missingRef = supplierPaymentInputSchema.safeParse({
      supplierId: "sup-1",
      date: "2026-11-02",
      method: "BANK_TRANSFER",
      reference: "",
      amountPaid: "5000.00",
      allocations: [
        { supplierBillId: "b1", cashApplied: "5000.00", withholdingApplied: "0", withholdingRate: "0" },
      ],
    });
    expect(missingRef.success).toBe(false);
    if (!missingRef.success) {
      const issue = missingRef.error.issues.find((i) => i.path.includes("reference"));
      expect(issue?.message).toBe("Add the UnionBank reference");
    }

    const withRef = supplierPaymentInputSchema.safeParse({
      supplierId: "sup-1",
      date: "2026-11-02",
      method: "BANK_TRANSFER",
      reference: "UB-TXN-987654",
      amountPaid: "5000.00",
      allocations: [
        { supplierBillId: "b1", cashApplied: "5000.00", withholdingApplied: "0", withholdingRate: "0" },
      ],
    });
    expect(withRef.success).toBe(true);
  });

  it("checks actions.ts enforces Attach proof of payment on missing files", () => {
    const src = readFileSync(path.join(process.cwd(), "src/app/(app)/payables/actions.ts"), "utf8");
    expect(src).toMatch(/Attach proof of payment/);
  });

  it("keeps check bank required and notes optional after the columns were made nullable", () => {
    const alloc = [{ supplierBillId: "b1", cashApplied: "100.00", withholdingApplied: "0", withholdingRate: "0" }];
    const checkMissingBank = supplierPaymentInputSchema.safeParse({
      supplierId: "sup-1",
      date: "2026-11-02",
      method: "CHECK",
      reference: "0012345",
      amountPaid: "100.00",
      allocations: alloc,
    });
    expect(checkMissingBank.success).toBe(false);
    if (!checkMissingBank.success) {
      expect(checkMissingBank.error.issues.find((i) => i.path.includes("checkBank"))?.message).toBe(
        "Bank is required for checks.",
      );
    }

    const checkEmptyBank = supplierPaymentInputSchema.safeParse({
      supplierId: "sup-1",
      date: "2026-11-02",
      method: "CHECK",
      reference: "0012345",
      checkBank: "   ",
      amountPaid: "100.00",
      allocations: alloc,
    });
    expect(checkEmptyBank.success).toBe(false);

    const checkOk = supplierPaymentInputSchema.safeParse({
      supplierId: "sup-1",
      date: "2026-11-02",
      method: "CHECK",
      reference: "0012345",
      checkBank: "UnionBank",
      amountPaid: "100.00",
      allocations: alloc,
    });
    expect(checkOk.success).toBe(true);

    const cashNoNotes = supplierPaymentInputSchema.safeParse({
      supplierId: "sup-1",
      date: "2026-11-02",
      method: "CASH",
      amountPaid: "100.00",
      allocations: alloc,
    });
    expect(cashNoNotes.success).toBe(true);
    if (cashNoNotes.success) expect(cashNoNotes.data.notes).toBeUndefined();

    const notesTooLong = supplierPaymentInputSchema.safeParse({
      supplierId: "sup-1",
      date: "2026-11-02",
      method: "CASH",
      notes: "x".repeat(5001),
      amountPaid: "100.00",
      allocations: alloc,
    });
    expect(notesTooLong.success).toBe(false);
  });

  it("rejects bank transfer without a reference, a check without a bank, missing proof, and non-admins before any write", async () => {
    const admin = { id: "admin-1", ...user(["ADMIN"]) };
    const approver = { id: "appr-1", ...user(["APPROVER"]) };
    await expect(recordSupplierPayment(paymentInput(), approver, proof)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordSupplierPayment(paymentInput(), { ...admin, active: false }, proof)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordSupplierPayment(paymentInput(), admin, [])).rejects.toMatchObject({
      message: "Attach proof of payment",
      field: "files",
    });
    await expect(recordSupplierPayment(paymentInput({ reference: null }), admin, proof)).rejects.toBeInstanceOf(DocRuleError);
    await expect(recordSupplierPayment(paymentInput({ reference: "   " }), admin, proof)).rejects.toThrow(/UnionBank reference/);
    await expect(
      recordSupplierPayment(paymentInput({ method: "CHECK", reference: "0012345", checkBank: null }), admin, proof),
    ).rejects.toThrow(/Bank is required for checks/);
    await expect(
      recordSupplierPayment(paymentInput({ method: "CHECK", reference: null, checkBank: "UnionBank" }), admin, proof),
    ).rejects.toThrow(/Check number is required/);
    await expect(recordSupplierPayment(paymentInput({ method: "E_WALLET", reference: null }), admin, proof)).rejects.toThrow(
      /Reference number is required/,
    );
  });

  it("reports cash off before it asks for proof", async () => {
    const prev = process.env.CASH_ENABLED;
    process.env.CASH_ENABLED = "false";
    try {
      const admin = { id: "admin-1", ...user(["ADMIN"]) };
      await expect(
        recordSupplierPayment(paymentInput({ cashAccountId: "cash-1" }), admin, []),
      ).rejects.toThrow(/Cash is turned off/);
    } finally {
      if (prev === undefined) delete process.env.CASH_ENABLED;
      else process.env.CASH_ENABLED = prev;
    }
  });
});

describe("Q06 S-41: Supplier payment allocation math and over-pay blocking", () => {
  it("partial allocation: PHP 25,000.00 against 40,000.00 bill leaves 15,000.00", () => {
    const left = supplierBillBalance("40000.00", { cashApplied: "25000.00", withholdingApplied: "0.00" });
    expect(left).toBe("15000.00");
    const status = deriveSupplierBillStatus("40000.00", { cashApplied: "25000.00", withholdingApplied: "0.00" });
    expect(status).toBe("PARTIALLY_PAID");
  });

  it("full allocation: pays rest -> Paid and disappears from We-owe list", () => {
    const left = supplierBillBalance("40000.00", { cashApplied: "40000.00", withholdingApplied: "0.00" });
    expect(left).toBe("0.00");
    const status = deriveSupplierBillStatus("40000.00", { cashApplied: "40000.00", withholdingApplied: "0.00" });
    expect(status).toBe("PAID");

    const bill = {
      id: "b1",
      billNumber: "BILL-001",
      dueDate: d("2026-11-15"),
      amount: "40000.00",
      status: "PAID" as const,
      supplier: { id: "s1", name: "Alpha Supplier" },
      purchaseOrder: null,
      allocations: [
        { cashApplied: "40000.00", withholdingApplied: "0.00", supplierPayment: { status: "POSTED" as const } },
      ],
    };
    const res = computeWeOweRows([bill], d("2026-11-02"));
    expect(res.rows).toHaveLength(0);
    expect(res.totalLeftToPay).toBe("0.00");
  });

  it("a stale PAID flag does not hide a balance, and cents stay exact", () => {
    const stale = {
      id: "b1",
      billNumber: "BILL-001",
      dueDate: d("2026-11-01"),
      amount: "40000.10",
      status: "PAID" as const,
      supplier: { id: "s1", name: "Alpha Supplier" },
      purchaseOrder: null,
      allocations: [
        { cashApplied: "25000.10", withholdingApplied: "0.00", supplierPayment: { status: "POSTED" as const } },
      ],
    };
    const res = computeWeOweRows([stale], d("2026-11-02"));
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.paid).toBe("25000.10");
    expect(res.rows[0]!.leftToPay).toBe("15000.00");
    expect(res.rows[0]!.dueLabel).toBe("Overdue");

    const cents = computeWeOweRows(
      [
        {
          id: "b2",
          billNumber: "BILL-002",
          dueDate: d("2026-11-08"),
          amount: "1.00",
          status: "PARTIALLY_PAID" as const,
          supplier: { id: "s1", name: "Alpha Supplier" },
          purchaseOrder: null,
          allocations: [
            { cashApplied: "0.10", withholdingApplied: "0.20", supplierPayment: { status: "POSTED" as const } },
          ],
        },
      ],
      d("2026-11-02"),
    );
    expect(cents.rows[0]!.paid).toBe("0.30");
    expect(cents.rows[0]!.leftToPay).toBe("0.70");
    expect(cents.rows[0]!.dueLabel).toBe("Due this week");
  });

  it("blocks over-pay when allocation exceeds bill left to pay", () => {
    const partialBills = [{ id: "b1", amount: "40000.00", alreadyCash: "25000.00", alreadyWithholding: "0.00" }];
    // Remaining is 15000.00. Attempting to allocate 16000.00:
    const issue = validatePaymentAllocations(
      "16000.00",
      [{ supplierBillId: "b1", cashApplied: "16000.00", withholdingApplied: "0.00", withholdingRate: "0.0000", atcCode: null }],
      partialBills,
    );
    expect(issue).not.toBeNull();
    expect(issue?.message).toMatch(/only has ₱15,?000\.00 left\. Lower the cash/i);
  });

  it("blocks over-pay when allocations sum over payment amount", () => {
    const bills = [{ id: "b1", amount: "40000.00", alreadyCash: "0.00", alreadyWithholding: "0.00" }];
    const issue = validatePaymentAllocations(
      "20000.00",
      [{ supplierBillId: "b1", cashApplied: "25000.00", withholdingApplied: "0.00", withholdingRate: "0.0000", atcCode: null }],
      bills,
    );
    expect(issue).not.toBeNull();
    expect(issue?.message).toMatch(/too much on bills/i);
  });
});

describe("Q06 S-41: We-owe totals, sorting, labels, and voided payment exclusion", () => {
  const today = d("2026-11-02");

  it("due date labels: Overdue before today, Due this week within 7 days", () => {
    // Past due (< today)
    expect(weOweDueLabel(d("2026-11-01"), today)).toBe("Overdue");
    expect(weOweDueLabel(d("2026-10-15"), today)).toBe("Overdue");
    // Due today through today + 7 days
    expect(weOweDueLabel(d("2026-11-02"), today)).toBe("Due this week");
    expect(weOweDueLabel(d("2026-11-05"), today)).toBe("Due this week");
    expect(weOweDueLabel(d("2026-11-09"), today)).toBe("Due this week");
    // Due 8+ days
    expect(weOweDueLabel(d("2026-11-10"), today)).toBeNull();
    expect(weOweDueLabel(d("2026-12-01"), today)).toBeNull();
  });

  it("sorts open bills ascending by dueDate and totals in Decimal math", () => {
    const billLate = {
      id: "b-late",
      billNumber: "BILL-200",
      dueDate: d("2026-11-20"),
      amount: "30000.00",
      status: "RECORDED" as const,
      supplier: { id: "s2", name: "Beta Supply", bankAccountNumber: "123456789012" },
      purchaseOrder: null,
      allocations: [],
    };
    const billEarly = {
      id: "b-early",
      billNumber: "BILL-100",
      dueDate: d("2026-10-25"),
      amount: "40000.00",
      status: "PARTIALLY_PAID" as const,
      supplier: { id: "s1", name: "Alpha Supply", bankAccountNumber: "987654321098" },
      purchaseOrder: { id: "po-1", number: "PO-2026-0001" },
      allocations: [
        { cashApplied: "25000.00", withholdingApplied: "0.00", supplierPayment: { status: "POSTED" as const } },
      ],
    };

    const res = computeWeOweRows([billLate, billEarly], today);
    expect(res.rows).toHaveLength(2);
    // Earliest due date comes first
    expect(res.rows[0]!.id).toBe("b-early");
    expect(res.rows[0]!.dueLabel).toBe("Overdue");
    expect(res.rows[0]!.amount).toBe("40000.00");
    expect(res.rows[0]!.paid).toBe("25000.00");
    expect(res.rows[0]!.leftToPay).toBe("15000.00");
    // Bank account is masked
    expect(res.rows[0]!.supplier.bankAccountNumber).toBe("•••• 1098");

    expect(res.rows[1]!.id).toBe("b-late");
    expect(res.rows[1]!.dueLabel).toBeNull();
    expect(res.rows[1]!.leftToPay).toBe("30000.00");

    // Totals in Decimal math (15,000 + 30,000 = 45,000.00)
    expect(res.totalLeftToPay).toBe("45000.00");
    expect(res.totalAmount).toBe("70000.00");
    expect(res.totalPaid).toBe("25000.00");
  });

  it("excludes voided payments from Paid and Left to pay", () => {
    const bill = {
      id: "b1",
      billNumber: "BILL-001",
      dueDate: d("2026-11-10"),
      amount: "40000.00",
      status: "PARTIALLY_PAID" as const,
      supplier: { id: "s1", name: "Alpha Supplier" },
      purchaseOrder: null,
      allocations: [
        // VOID payment of 10,000.00 must NOT count towards Paid or reduce Left to pay
        { cashApplied: "10000.00", withholdingApplied: "0.00", supplierPayment: { status: "VOID" as const } },
        // POSTED payment of 15,000.00
        { cashApplied: "15000.00", withholdingApplied: "0.00", supplierPayment: { status: "POSTED" as const } },
      ],
    };

    const res = computeWeOweRows([bill], today);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.paid).toBe("15000.00");
    expect(res.rows[0]!.leftToPay).toBe("25000.00");
    expect(res.totalLeftToPay).toBe("25000.00");
    expect(res.totalPaid).toBe("15000.00");

    const missingPayment = computeWeOweRows(
      [
        {
          ...bill,
          allocations: [
            { cashApplied: "40000.00", withholdingApplied: "0.00", supplierPayment: null },
            { cashApplied: "10000.00", withholdingApplied: "0.00" },
          ],
        },
      ],
      today,
    );
    expect(missingPayment.rows[0]!.paid).toBe("0.00");
    expect(missingPayment.rows[0]!.leftToPay).toBe("40000.00");
  });

  it("bank account masking helper shows last 4 only", () => {
    expect(maskBankAccountNumber("123456789012")).toBe("•••• 9012");
    expect(maskBankAccountNumber("")).toBe("");
    expect(maskBankAccountNumber(null)).toBe("");
  });
});

describe("supplier payment withholding rate", () => {
  const base = (rate: string, withholdingApplied = "100.00") => ({
    supplierId: "s1",
    date: "2026-11-07",
    method: "CASH" as const,
    amountPaid: "10000.00",
    allocations: [
      {
        supplierBillId: "b1",
        cashApplied: "9900.00",
        withholdingApplied,
        withholdingRate: rate,
        atcCode: null,
      },
    ],
  });

  it("stores a typed percent as a fraction (1 → 0.0100, 2.5 → 0.0250) and keeps a fraction as-is", () => {
    expect(supplierPaymentInputSchema.safeParse(base("1")).data?.allocations[0]?.withholdingRate).toBe("0.0100");
    expect(supplierPaymentInputSchema.safeParse(base("2.5")).data?.allocations[0]?.withholdingRate).toBe("0.0250");
    expect(supplierPaymentInputSchema.safeParse(base("0.01")).data?.allocations[0]?.withholdingRate).toBe("0.0100");
    // Rate 0 is only valid when nothing is withheld.
    expect(supplierPaymentInputSchema.safeParse(base("0", "0")).data?.allocations[0]?.withholdingRate).toBe("0.0000");
  });

  it("rejects a withheld amount with no rate (stops 0.00% on the 2307 row)", () => {
    const parsed = supplierPaymentInputSchema.safeParse(base("0"));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((i) => i.message).join(" ")).toMatch(/withholding rate/i);
    }
  });

  it("accepts no withholding with no rate", () => {
    expect(supplierPaymentInputSchema.safeParse(base("0", "0")).success).toBe(true);
  });
});
