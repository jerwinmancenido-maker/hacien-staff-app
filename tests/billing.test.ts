import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/format";
import { agingBucket, sumAging } from "@/lib/billing/aging";
import {
  autoAllocateOldestFirst,
  minMoney,
  planCreditApplication,
  validateAllocations,
  wouldExceedCredit,
} from "@/lib/billing/allocations";
import { applyCreditInputSchema } from "@/lib/validation/billing";
import { bookletGrid, bookletRangeError, inBookletRange } from "@/lib/billing/booklet";
import { calendarDaysBetween, daysPastDue, dueDateFromTerms, isOverdue } from "@/lib/billing/dates";
import {
  billingBalance,
  deriveBillingStatus,
  netExpected,
  openingCreditAsOf,
  proRataWithholding,
  remainingToBill,
  unappliedCash,
  unappliedCashAsOf,
} from "@/lib/billing/status";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import { formatDocNumber } from "@/lib/settings/numbering";
import { can, roleFlags, type PermissionUser, type Role } from "@/lib/permissions";

const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

describe("due date from terms", () => {
  const inv = d("2026-03-15");
  it("COD and blank → invoice date", () => {
    expect(dueDateFromTerms(inv, "COD").toISOString()).toBe(inv.toISOString());
    expect(dueDateFromTerms(inv, null).toISOString()).toBe(inv.toISOString());
    expect(dueDateFromTerms(inv, "").toISOString()).toBe(inv.toISOString());
  });
  it("Net N adds N days", () => {
    expect(dueDateFromTerms(inv, "Net 15").toISOString()).toBe(addDays(inv, 15).toISOString());
    expect(dueDateFromTerms(inv, "Net 30").toISOString()).toBe(addDays(inv, 30).toISOString());
    expect(dueDateFromTerms(inv, "net 60").toISOString()).toBe(addDays(inv, 60).toISOString());
  });
  it("50/50 defaults to invoice date", () => {
    expect(dueDateFromTerms(inv, "50% down, 50% on delivery").toISOString()).toBe(inv.toISOString());
  });
});

describe("aging bucket boundaries (Manila DATE math)", () => {
  const today = d("2026-06-15");
  it("current when due today or later", () => {
    expect(agingBucket(today, today)).toBe("current");
    expect(agingBucket(addDays(today, 1), today)).toBe("current");
    expect(calendarDaysBetween(today, today)).toBe(0);
  });
  it("1–30 at 1 and 30 days past due", () => {
    expect(agingBucket(addDays(today, -1), today)).toBe("d1_30");
    expect(agingBucket(addDays(today, -30), today)).toBe("d1_30");
  });
  it("31–60 at 31 and 60", () => {
    expect(agingBucket(addDays(today, -31), today)).toBe("d31_60");
    expect(agingBucket(addDays(today, -60), today)).toBe("d31_60");
  });
  it("61–90 at 61 and 90", () => {
    expect(agingBucket(addDays(today, -61), today)).toBe("d61_90");
    expect(agingBucket(addDays(today, -90), today)).toBe("d61_90");
  });
  it("90+ at 91", () => {
    expect(agingBucket(addDays(today, -91), today)).toBe("d90_plus");
  });
  it("sumAging ignores zero/negative balances", () => {
    const a = sumAging(
      [
        { dueDate: today, balance: "100.00" },
        { dueDate: addDays(today, -10), balance: "50.00" },
        { dueDate: addDays(today, -10), balance: "0.00" },
      ],
      today,
    );
    expect(a.current).toBe("100.00");
    expect(a.d1_30).toBe("50.00");
    expect(a.total).toBe("150.00");
  });
});

describe("overdue", () => {
  const due = d("2026-01-01");
  const today = d("2026-01-10");
  it("days past due and grace", () => {
    expect(daysPastDue(due, today, 0)).toBe(9);
    expect(daysPastDue(due, today, 10)).toBe(0);
    expect(isOverdue(due, "1.00", today, 0)).toBe(true);
    expect(isOverdue(due, "0.00", today, 0)).toBe(false);
  });
});

describe("billing amounts & status", () => {
  it("remaining to bill", () => {
    expect(remainingToBill("1000.00", ["400.00", "100.00"])).toBe("500.00");
    expect(remainingToBill("100.00", ["100.00"])).toBe("0.00");
  });
  it("rejects over-billing conceptually (remaining check)", () => {
    const rem = remainingToBill("500.00", ["400.00"]);
    expect(Number("150.00") > Number(rem)).toBe(true);
  });
  it("pro-rata withholding and net", () => {
    expect(proRataWithholding("500.00", "1000.00", "20.00")).toBe("10.00");
    expect(netExpected("500.00", "10.00")).toBe("490.00");
  });
  it("balance and status derivation", () => {
    expect(billingBalance("100.00", { cashApplied: "40.00", withholdingApplied: "10.00" })).toBe("50.00");
    expect(deriveBillingStatus("100.00", { cashApplied: "0", withholdingApplied: "0" })).toBe("OPEN");
    expect(deriveBillingStatus("100.00", { cashApplied: "40.00", withholdingApplied: "10.00" })).toBe("PARTIALLY_PAID");
    expect(deriveBillingStatus("100.00", { cashApplied: "90.00", withholdingApplied: "10.00" })).toBe("PAID");
  });
  it("unapplied cash / credit", () => {
    expect(unappliedCash("1000.00", ["300.00", "200.00"])).toBe("500.00");
    expect(wouldExceedCredit("100.00", "100.01")).toBe(true);
    expect(wouldExceedCredit("100.00", "100.00")).toBe(false);
  });
});

describe("invoice booklet", () => {
  const range = DEFAULT_SETTINGS.invoiceBooklet;
  it("range check", () => {
    expect(inBookletRange(1, range)).toBe(true);
    expect(inBookletRange(500, range)).toBe(true);
    expect(inBookletRange(501, range)).toBe(false);
    expect(bookletRangeError(0, range)).toMatch(/whole/);
    expect(bookletRangeError(501, range)).toMatch(/between/);
  });
  it("grid marks used / voided / free; next free skips voided", () => {
    const g = bookletGrid(range, [
      { invoiceNo: 1, id: "a", number: "BL-1", status: "OPEN" },
      { invoiceNo: 2, id: "b", number: "BL-2", status: "VOID" },
    ]);
    expect(g.slots[0]!.status).toBe("used");
    expect(g.slots[1]!.status).toBe("voided");
    expect(g.slots[2]!.status).toBe("free");
    expect(g.nextFree).toBe(3);
    expect(g.voidedCount).toBe(1);
  });
});

describe("allocation rules", () => {
  const billings = [
    { id: "b1", amount: "100.00", alreadyCash: "0.00", alreadyWithholding: "0.00", dueDate: d("2026-01-01") },
    { id: "b2", amount: "50.00", alreadyCash: "0.00", alreadyWithholding: "0.00", dueDate: d("2026-02-01") },
  ];
  it("auto-fills oldest first", () => {
    const a = autoAllocateOldestFirst("120.00", billings);
    expect(a).toEqual([
      { billingId: "b1", cashApplied: "100.00", withholdingApplied: "0.00" },
      { billingId: "b2", cashApplied: "20.00", withholdingApplied: "0.00" },
    ]);
  });
  it("allows unapplied cash (credit)", () => {
    expect(validateAllocations("200.00", [{ billingId: "b1", cashApplied: "50.00", withholdingApplied: "0" }], billings)).toBeNull();
  });
  it("rejects cash applied over amount received", () => {
    const err = validateAllocations(
      "40.00",
      [{ billingId: "b1", cashApplied: "50.00", withholdingApplied: "0" }],
      billings,
    );
    expect(err?.message).toMatch(/exceed/);
  });
  it("rejects over-balance on a billing", () => {
    const err = validateAllocations(
      "200.00",
      [{ billingId: "b1", cashApplied: "90.00", withholdingApplied: "20.00" }],
      billings,
    );
    expect(err?.message).toMatch(/remaining balance/);
  });
  it("plans credit apply FIFO across sources (cash only)", () => {
    const planned = planCreditApplication(
      "150.00",
      [
        { collectionId: "c1", unappliedCredit: "100.00" },
        { collectionId: "c2", unappliedCredit: "80.00" },
      ],
      "b1",
    );
    expect(planned).toEqual([
      { collectionId: "c1", billingId: "b1", cashApplied: "100.00", withholdingApplied: "0.00" },
      { collectionId: "c2", billingId: "b1", cashApplied: "50.00", withholdingApplied: "0.00" },
    ]);
  });
  it("planCreditApplication fails when credit is short", () => {
    expect(() =>
      planCreditApplication("50.00", [{ collectionId: "c1", unappliedCredit: "20.00" }], "b1"),
    ).toThrow(/Not enough customer credit/);
  });
  it("minMoney picks the smaller scaled amount", () => {
    expect(minMoney("100.00", "40.50")).toBe("40.50");
    expect(minMoney("10.00", "10.00")).toBe("10.00");
  });
  it("applyCreditInputSchema rejects withholding on credit apply", () => {
    const bad = applyCreditInputSchema.safeParse({
      customerId: "cust",
      allocations: [
        {
          collectionId: "c1",
          billingId: "b1",
          cashApplied: "0.00",
          withholdingApplied: "50.00",
        },
      ],
    });
    expect(bad.success).toBe(false);
  });
});

describe("billing numbering defaults", () => {
  it("formats BL / CR", () => {
    expect(formatDocNumber(DEFAULT_SETTINGS.numbering.billing, 2026, 1)).toBe("BL-2026-0001");
    expect(formatDocNumber(DEFAULT_SETTINGS.numbering.collection, 2026, 12)).toBe("CR-2026-0012");
  });
});

describe("manage_billing permission", () => {
  const user = (roles: Role[]): PermissionUser => ({ ...roleFlags(roles), active: true, canSeeCosts: false });
  it("Admin and Approver may manage; Staff and Viewer may not", () => {
    expect(can(user(["ADMIN"]), "manage_billing")).toBe(true);
    expect(can(user(["APPROVER"]), "manage_billing")).toBe(true);
    expect(can(user(["STAFF"]), "manage_billing")).toBe(false);
    expect(can(user(["VIEWER"]), "manage_billing")).toBe(false);
  });
});

describe("statement running balance (unit)", () => {
  it("charges increase and credits decrease", () => {
    let running = 0n;
    const steps = [
      { kind: "billing" as const, amount: "1000.00" },
      { kind: "collection" as const, cash: "400.00", withholding: "20.00", unapplied: "0.00" },
      { kind: "collection" as const, cash: "0.00", withholding: "0.00", unapplied: "100.00" },
    ];
    const bals: string[] = [];
    for (const s of steps) {
      if (s.kind === "billing") running += BigInt(Math.round(Number(s.amount) * 100));
      else running -= BigInt(Math.round((Number(s.cash) + Number(s.withholding) + Number(s.unapplied)) * 100));
      bals.push((Number(running) / 100).toFixed(2));
    }
    expect(bals).toEqual(["1000.00", "580.00", "480.00"]);
  });
});

describe("filtered SOA opening credit as of from (unit)", () => {
  const from = d("2026-02-01");

  it("collection before from, applied inside the period, still counts as opening credit", () => {
    // ₱1000 collected Jan 15 (unapplied). ₱400 applied Feb 10 — after `from`.
    // As of Feb 1 the full ₱1000 is still opening credit (not today's ₱600).
    const u = unappliedCashAsOf(
      "1000.00",
      [
        { cashApplied: "400.00", date: d("2026-02-10") },
      ],
      from,
    );
    expect(u).toBe("1000.00");
    expect(
      openingCreditAsOf(
        [
          {
            amountReceived: "1000.00",
            applications: [{ cashApplied: "400.00", date: d("2026-02-10") }],
          },
        ],
        from,
      ),
    ).toBe("1000.00");
  });

  it("application before from reduces opening credit", () => {
    // ₱1000 collected Jan 10; ₱300 applied Jan 10 (before `from`) → ₱700 opening credit.
    expect(
      openingCreditAsOf(
        [
          {
            amountReceived: "1000.00",
            applications: [{ cashApplied: "300.00", date: d("2026-01-10") }],
          },
        ],
        from,
      ),
    ).toBe("700.00");
    // Mixed: prior apply reduces; in-period apply does not.
    expect(
      openingCreditAsOf(
        [
          {
            amountReceived: "1000.00",
            applications: [
              { cashApplied: "300.00", date: d("2026-01-10") },
              { cashApplied: "200.00", date: d("2026-02-15") },
            ],
          },
        ],
        from,
      ),
    ).toBe("700.00");
  });

  it("application on from does not reduce opening credit (strict lt)", () => {
    // Helpers use `date < asOf`; getStatement filters `appliedOn: { lt: from }`.
    // So appliedOn === from is inside the period (not opening), matching collections
    // with date >= from that appear on period lines rather than in opening credit.
    expect(unappliedCashAsOf("1000.00", [{ cashApplied: "400.00", date: from }], from)).toBe("1000.00");
    expect(
      openingCreditAsOf(
        [{ amountReceived: "1000.00", applications: [{ cashApplied: "400.00", date: from }] }],
        from,
      ),
    ).toBe("1000.00");
  });
});
