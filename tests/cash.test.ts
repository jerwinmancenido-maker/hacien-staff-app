import { describe, expect, it } from "vitest";
import {
  accountBalanceAsOf,
  buildLedger,
  ledgerToCsv,
  prevYmd,
  ymdCmp,
} from "@/lib/cash/balance";
import { dealsNavHrefs } from "@/components/Sidebar";
import { CASH_OFF_MESSAGE, cashEnabledFromEnv } from "@/lib/cash/features";
import { can, roleFlags, type PermissionUser, type Role } from "@/lib/permissions";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import { formatDocNumber } from "@/lib/settings/numbering";
import { cashAccountInputSchema, cashTransferInputSchema, expenseInputSchema } from "@/lib/validation/cash";

function user(roles: Role[]): PermissionUser {
  return { ...roleFlags(roles), active: true, canSeeCosts: false };
}

describe("manage_cash permission", () => {
  it("Admin and Approver only", () => {
    expect(can(user(["ADMIN"]), "manage_cash")).toBe(true);
    expect(can(user(["APPROVER"]), "manage_cash")).toBe(true);
    expect(can(user(["STAFF"]), "manage_cash")).toBe(false);
    expect(can(user(["VIEWER"]), "manage_cash")).toBe(false);
  });
});

describe("cash feature flag", () => {
  it("defaults off; env overrides", () => {
    expect(cashEnabledFromEnv({})).toBe(null);
    expect(cashEnabledFromEnv({ CASH_ENABLED: "true" })).toBe(true);
    expect(cashEnabledFromEnv({ CASH_ENABLED: "0" })).toBe(false);
    expect(DEFAULT_SETTINGS.features.cashEnabled).toBe(false);
    expect(CASH_OFF_MESSAGE).toMatch(/Cash is turned off/);
  });
});

describe("Cash sidebar gating (CASH_ENABLED)", () => {
  const base = { canSeeCosts: true, canEdit: true, payablesEnabled: false };

  it("hides Cash when the flag is off", () => {
    expect(dealsNavHrefs({ ...base, cashEnabled: false })).not.toContain("/cash");
  });

  it("shows Cash when the flag is on", () => {
    expect(dealsNavHrefs({ ...base, cashEnabled: true })).toContain("/cash");
  });
});

describe("EXP / TRF numbering defaults", () => {
  it("uses PAY-style prefixes", () => {
    expect(formatDocNumber(DEFAULT_SETTINGS.numbering.expense, 2026, 1)).toBe("EXP-2026-0001");
    expect(formatDocNumber(DEFAULT_SETTINGS.numbering.cashTransfer, 2026, 12)).toBe("TRF-2026-0012");
  });
});

describe("cash account balance (scaled decimals, voids, mixed kinds)", () => {
  const opening = "10000.00";
  const openingDate = "2026-01-01";

  const mixed = [
    { date: "2026-01-05", amount: "2500.50", direction: "IN" as const, voided: false }, // collection
    { date: "2026-01-06", amount: "1000.25", direction: "OUT" as const, voided: false }, // supplier payment
    { date: "2026-01-07", amount: "500.00", direction: "OUT" as const, voided: false }, // expense
    { date: "2026-01-08", amount: "200.00", direction: "TRANSFER_OUT" as const, voided: false },
    { date: "2026-01-09", amount: "50.00", direction: "TRANSFER_IN" as const, voided: false },
    { date: "2026-01-10", amount: "999.99", direction: "OUT" as const, voided: true }, // voided expense ignored
  ];

  it("computes balance with collections, payments, expenses, transfers; voids drop out", () => {
    // 10000 + 2500.50 - 1000.25 - 500 - 200 + 50 = 10850.25 (void ignored)
    expect(accountBalanceAsOf(opening, openingDate, mixed)).toBe("10850.25");
  });

  it("cutoff by PHT calendar date (as-of)", () => {
    expect(accountBalanceAsOf(opening, openingDate, mixed, "2026-01-05")).toBe("12500.50");
    expect(accountBalanceAsOf(opening, openingDate, mixed, "2026-01-01")).toBe("10000.00");
    expect(accountBalanceAsOf(opening, openingDate, mixed, "2025-12-31")).toBe("0.00");
  });

  it("never uses floats for awkward cents", () => {
    const entries = [
      { date: "2026-02-01", amount: "0.10", direction: "IN" as const },
      { date: "2026-02-02", amount: "0.20", direction: "IN" as const },
      { date: "2026-02-03", amount: "0.30", direction: "OUT" as const },
    ];
    // 0 + 0.10 + 0.20 - 0.30 = 0.00 exactly
    expect(accountBalanceAsOf("0.00", "2026-02-01", entries)).toBe("0.00");
  });
});

describe("ledger running balance + CSV", () => {
  it("builds ascending ledger with running balance and links", () => {
    const rows = buildLedger({
      openingBalance: "100.00",
      openingDate: "2026-03-01",
      entries: [
        {
          id: "c1",
          kind: "COLLECTION",
          number: "CR-2026-0001",
          date: "2026-03-02",
          amount: "50.00",
          direction: "IN",
          description: "Collection · Sample",
          href: "/billing/collections/c1",
        },
        {
          id: "e1",
          kind: "EXPENSE",
          number: "EXP-2026-0001",
          date: "2026-03-03",
          amount: "20.00",
          direction: "OUT",
          description: "Expense · Rent",
          href: "/cash/expenses/e1",
          voided: true,
        },
        {
          id: "p1",
          kind: "SUPPLIER_PAYMENT",
          number: "PAY-2026-0001",
          date: "2026-03-04",
          amount: "30.00",
          direction: "OUT",
          description: "Supplier payment · Acme",
          href: "/payables/payments/p1",
        },
      ],
    });
    // voided expense excluded from rows
    expect(rows.map((r) => r.number)).toEqual(["—", "CR-2026-0001", "PAY-2026-0001"]);
    expect(rows[0]!.runningBalance).toBe("100.00");
    expect(rows[1]!.runningBalance).toBe("150.00");
    expect(rows[2]!.runningBalance).toBe("120.00");
    expect(rows[1]!.href).toBe("/billing/collections/c1");
  });

  it("date window uses PHT dates and continues running balance", () => {
    const rows = buildLedger({
      openingBalance: "1000.00",
      openingDate: "2026-01-01",
      fromYmd: "2026-01-10",
      toYmd: "2026-01-20",
      entries: [
        {
          id: "a",
          kind: "COLLECTION",
          number: "CR-1",
          date: "2026-01-05",
          amount: "100.00",
          direction: "IN",
          description: "before",
          href: null,
        },
        {
          id: "b",
          kind: "EXPENSE",
          number: "EXP-1",
          date: "2026-01-15",
          amount: "50.00",
          direction: "OUT",
          description: "in range",
          href: "/cash/expenses/b",
        },
        {
          id: "c",
          kind: "COLLECTION",
          number: "CR-2",
          date: "2026-01-25",
          amount: "10.00",
          direction: "IN",
          description: "after",
          href: null,
        },
      ],
    });
    // starting = 1000 + 100 (before from) = 1100; then -50 → 1050
    expect(rows).toHaveLength(1);
    expect(rows[0]!.number).toBe("EXP-1");
    expect(rows[0]!.runningBalance).toBe("1050.00");
  });

  it("exports CSV without float artifacts", () => {
    const rows = buildLedger({
      openingBalance: "0.10",
      openingDate: "2026-04-01",
      entries: [
        {
          id: "x",
          kind: "COLLECTION",
          number: "CR-1",
          date: "2026-04-02",
          amount: "0.20",
          direction: "IN",
          description: "in",
          href: null,
        },
      ],
    });
    const csv = ledgerToCsv(rows);
    expect(csv).toContain("0.10");
    expect(csv).toContain("0.20");
    expect(csv).toContain("0.30");
    expect(csv.split("\n")[0]).toMatch(/Date,Type,Number/);
  });
});

describe("ymd helpers", () => {
  it("compares and steps calendar days", () => {
    expect(ymdCmp("2026-01-01", "2026-01-02")).toBe(-1);
    expect(prevYmd("2026-01-01")).toBe("2025-12-31");
  });
});

describe("cash validation", () => {
  it("requires last-4 digits only and bank name for BANK", () => {
    const bad = cashAccountInputSchema.safeParse({
      name: "UB",
      type: "BANK",
      bankName: "",
      accountHintLast4: "12345",
      openingBalance: "0",
      openingDate: "2026-01-01",
      active: true,
    });
    expect(bad.success).toBe(false);

    const ok = cashAccountInputSchema.safeParse({
      name: "UB operating",
      type: "BANK",
      bankName: "UnionBank",
      accountHintLast4: "1234",
      openingBalance: "1000.00",
      openingDate: "2026-01-01",
      active: true,
    });
    expect(ok.success).toBe(true);
  });

  it("requires payee or supplier on expense", () => {
    const bad = expenseInputSchema.safeParse({
      date: "2026-01-01",
      supplierId: "",
      payeeText: "",
      categoryId: "cat",
      amount: "100.00",
      withholdingApplied: "",
      cashAccountId: "acc",
      receiptNo: "",
      notes: "",
    });
    expect(bad.success).toBe(false);

    const ok = expenseInputSchema.safeParse({
      date: "2026-01-01",
      supplierId: "",
      payeeText: "Meralco",
      categoryId: "cat",
      amount: "100.00",
      withholdingApplied: "1.00",
      cashAccountId: "acc",
      receiptNo: "OR-1",
      notes: "",
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.withholdingApplied).toBe("1.00");
  });

  it("rejects same from/to on transfer", () => {
    const bad = cashTransferInputSchema.safeParse({
      date: "2026-01-01",
      fromAccountId: "a",
      toAccountId: "a",
      amount: "50.00",
      notes: "",
    });
    expect(bad.success).toBe(false);
  });
});
