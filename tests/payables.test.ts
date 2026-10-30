import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/format";
import { agingBucket, sumAging } from "@/lib/billing/aging";
import { autoAllocateBillsOldestFirst, validatePaymentAllocations } from "@/lib/payables/allocations";
import { deriveSupplierBillStatus, supplierBillBalance, withholdingFromRate } from "@/lib/payables/status";
import { dealsNavHrefs } from "@/components/Sidebar";
import { payablesEnabledFromEnv } from "@/lib/payables/features";
import { can, roleFlags, type PermissionUser, type Role } from "@/lib/permissions";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import { formatDocNumber } from "@/lib/settings/numbering";

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
