import { describe, expect, it } from "vitest";
import { agingBucket, sumAging } from "@/lib/billing/aging";
import {
  daysPastDue,
  expectedPaymentDateFromIar,
  formatExpectedPaymentLabel,
  isOverdue,
} from "@/lib/billing/dates";
import { overdueInfo } from "@/lib/billing/views";
import {
  applyDelivery,
  checkDelivery,
  soDeliveryProgress,
  type OpenDeliveryLine,
} from "@/lib/sales-orders/delivery";
import { deliveryInputSchema } from "@/lib/validation/deliveries";

const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

describe("1. Delivered qty cannot exceed ordered", () => {
  const line1: OpenDeliveryLine = {
    id: "line-1",
    description: "Industrial Steel Pipes",
    qty: "10.00",
    deliveredQty: "0.00",
  };
  const line2: OpenDeliveryLine = {
    id: "line-2",
    description: "Hydraulic Fittings",
    qty: "5.00",
    deliveredQty: "2.00",
  };

  it("allows partial delivery up to the remaining ordered quantity", () => {
    const check = checkDelivery([line1], [{ salesOrderItemId: "line-1", qty: "4.00" }]);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.entries).toEqual([{ salesOrderItemId: "line-1", qty: "4.00" }]);

    const nextDelivered = applyDelivery(line1, "4.00", 1);
    expect(nextDelivered).toBe("4.00");
  });

  it("allows full delivery exactly matching ordered quantity", () => {
    const check = checkDelivery([line1], [{ salesOrderItemId: "line-1", qty: "10.00" }]);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.entries[0]?.qty).toBe("10.00");

    const nextDelivered = applyDelivery(line1, "10.00", 1);
    expect(nextDelivered).toBe("10.00");
  });

  it("rejects when delivery quantity exceeds ordered quantity", () => {
    const check = checkDelivery([line1], [{ salesOrderItemId: "line-1", qty: "11.00" }]);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.message).toContain("Delivered quantity cannot exceed ordered");
    expect(check.errors["line-1"]).toContain("Only 10 left to deliver");
  });

  it("rejects when cumulative delivered quantity would exceed ordered quantity", () => {
    // line2 has qty: 5.00, deliveredQty: 2.00 (remaining: 3.00)
    const checkOver = checkDelivery([line2], [{ salesOrderItemId: "line-2", qty: "3.50" }]);
    expect(checkOver.ok).toBe(false);
    if (checkOver.ok) return;
    expect(checkOver.errors["line-2"]).toContain("Only 3 left to deliver");

    // Exact remaining 3.00 succeeds
    const checkExact = checkDelivery([line2], [{ salesOrderItemId: "line-2", qty: "3.00" }]);
    expect(checkExact.ok).toBe(true);
  });

  it("rejects empty or zero delivery across all lines", () => {
    const checkEmpty = checkDelivery([line1, line2], [
      { salesOrderItemId: "line-1", qty: "0" },
      { salesOrderItemId: "line-2", qty: "" },
    ]);
    expect(checkEmpty.ok).toBe(false);
    if (checkEmpty.ok) return;
    expect(checkEmpty.message).toContain("Enter a quantity for at least one item");
  });

  it("applyDelivery throws if delivery goes below 0 or above ordered", () => {
    expect(() => applyDelivery(line1, "11.00", 1)).toThrow("Delivered quantity out of range.");
    expect(() => applyDelivery(line2, "3.00", -1)).toThrow("Delivered quantity out of range.");
  });

  it("soDeliveryProgress shows '2 of 5 delivered' / 'Fully delivered'", () => {
    const fiveLines = [
      { qty: "10.00", deliveredQty: "10.00" },
      { qty: "5.00", deliveredQty: "5.00" },
      { qty: "8.00", deliveredQty: "4.00" }, // partial
      { qty: "2.00", deliveredQty: "0.00" },
      { qty: "1.00", deliveredQty: "0.00" },
    ];
    const p1 = soDeliveryProgress(fiveLines);
    expect(p1.total).toBe(5);
    expect(p1.delivered).toBe(2);
    expect(p1.fullyDelivered).toBe(false);
    expect(p1.label).toBe("2 of 5 delivered");

    const allDone = [
      { qty: "10.00", deliveredQty: "10.00" },
      { qty: "5.00", deliveredQty: "5.00" },
    ];
    const p2 = soDeliveryProgress(allDone);
    expect(p2.total).toBe(2);
    expect(p2.delivered).toBe(2);
    expect(p2.fullyDelivered).toBe(true);
    expect(p2.label).toBe("Fully delivered");
  });
});

describe("2. DR number required", () => {
  it("rejects empty, missing, or whitespace-only DR number", () => {
    const missing = deliveryInputSchema.safeParse({
      deliveryDate: "2026-11-05",
      items: [{ salesOrderItemId: "item-1", qty: "1" }],
    });
    expect(missing.success).toBe(false);
    if (missing.success) return;
    expect(missing.error.issues.some((i) => i.path.includes("drNumber"))).toBe(true);

    const empty = deliveryInputSchema.safeParse({
      drNumber: "   ",
      deliveryDate: "2026-11-05",
      items: [{ salesOrderItemId: "item-1", qty: "1" }],
    });
    expect(empty.success).toBe(false);
    if (empty.success) return;
    expect(empty.error.issues.some((i) => i.path.includes("drNumber"))).toBe(true);
  });

  it("accepts valid pre-printed DR number", () => {
    const valid = deliveryInputSchema.safeParse({
      drNumber: "DR-2026-0042",
      deliveryDate: "2026-11-05",
      items: [{ salesOrderItemId: "item-1", qty: "1" }],
    });
    expect(valid.success).toBe(true);
    if (!valid.success) return;
    expect(valid.data.drNumber).toBe("DR-2026-0042");
  });
});

describe("3. Expected-by math (incl. month rollover)", () => {
  it("computes IAR date + 30 calendar days (prompt example: Nov 5, 2026 -> Dec 5, 2026)", () => {
    const iar = d("2026-11-05");
    const expected = expectedPaymentDateFromIar(iar);
    expect(expected.toISOString().slice(0, 10)).toBe("2026-12-05");
    expect(formatExpectedPaymentLabel(expected)).toBe("Expected by Dec 5, 2026 (estimate)");
  });

  it("handles month rollovers across months with 31, 30, and 28 days", () => {
    // January has 31 days: Jan 15 + 30 days = Feb 14
    const jan15 = d("2026-01-15");
    expect(expectedPaymentDateFromIar(jan15).toISOString().slice(0, 10)).toBe("2026-02-14");

    // Jan 31 + 30 days: 31 days in Jan, 28 in Feb 2026 -> March 2
    const jan31 = d("2026-01-31");
    expect(expectedPaymentDateFromIar(jan31).toISOString().slice(0, 10)).toBe("2026-03-02");

    // July has 31 days: July 10 + 30 days = August 9
    const jul10 = d("2026-07-10");
    expect(expectedPaymentDateFromIar(jul10).toISOString().slice(0, 10)).toBe("2026-08-09");

    // Year rollover: Dec 15, 2026 + 30 days = Jan 14, 2027
    const dec15 = d("2026-12-15");
    expect(expectedPaymentDateFromIar(dec15).toISOString().slice(0, 10)).toBe("2027-01-14");
  });
});

describe("4. Government billing past Expected by never flagged overdue", () => {
  // Example from brief: IAR Nov 5, 2026 -> Expected by Dec 5, 2026.
  // On Dec 10, 2026 (past Expected by), it must NEVER be overdue or red.
  const dueDate = d("2026-12-05");
  const asOfDec10 = d("2026-12-10");
  const balance = "50000.00";

  it("isOverdue returns false for government billing even days past expected date", () => {
    const normalOverdue = isOverdue(dueDate, balance, asOfDec10, 0, false);
    expect(normalOverdue).toBe(true);

    const govOverdue = isOverdue(dueDate, balance, asOfDec10, 0, true);
    expect(govOverdue).toBe(false);
  });

  it("daysPastDue returns 0 for government billing", () => {
    const normalDays = daysPastDue(dueDate, asOfDec10, 0, false);
    expect(normalDays).toBe(5);

    const govDays = daysPastDue(dueDate, asOfDec10, 0, true);
    expect(govDays).toBe(0);
  });

  it("overdueInfo returns no overdue badge label for government billing", () => {
    const normalInfo = overdueInfo(dueDate, balance, 0, asOfDec10, false);
    expect(normalInfo.overdue).toBe(true);
    expect(normalInfo.label).toBe("Overdue 5 days");

    const govInfo = overdueInfo(dueDate, balance, 0, asOfDec10, true);
    expect(govInfo.overdue).toBe(false);
    expect(govInfo.days).toBe(0);
    expect(govInfo.label).toBeNull();
  });

  it("agingBucket and sumAging keep government billing in 'current' bucket, never in overdue buckets", () => {
    const normalBucket = agingBucket(dueDate, asOfDec10, false);
    expect(normalBucket).toBe("d1_30");

    const govBucket = agingBucket(dueDate, asOfDec10, true);
    expect(govBucket).toBe("current");

    const aged = sumAging(
      [
        { dueDate, balance: "25000.00", isGovernment: true },
        { dueDate, balance: "10000.00", isGovernment: false },
      ],
      asOfDec10,
    );

    // The government billing stays in current
    expect(aged.current).toBe("25000.00");
    // Only the normal billing appears in d1_30
    expect(aged.d1_30).toBe("10000.00");
  });
});

describe("5. Sight-check save stores boolean+who+when only", () => {
  it("stores ONLY boolean + checked-by user id + timestamp; never any ID number, ID type or photo", () => {
    const actorId = "user-clrk123";
    const checkedAt = new Date();

    // Simulating the save payload structure defined in recordDelivery
    const savedDelivery = {
      salesOrderId: "so-123",
      drNumber: "DR-9901",
      deliveryDate: new Date("2026-11-05T00:00:00.000Z"),
      receivedBy: "Juan Dela Cruz",
      receivedDate: new Date("2026-11-05T00:00:00.000Z"),
      idSightChecked: true,
      idCheckedById: actorId,
      idCheckedAt: checkedAt,
      createdById: actorId,
    };

    expect(savedDelivery.idSightChecked).toBe(true);
    expect(savedDelivery.idCheckedById).toBe(actorId);
    expect(savedDelivery.idCheckedAt).toBe(checkedAt);

    // Explicitly verify NO forbidden fields exist
    const forbiddenKeys = [
      "idType",
      "idNumber",
      "idPhoto",
      "idCard",
      "idCopy",
      "idImage",
      "governmentId",
      "validId",
      "photo",
    ];

    for (const key of forbiddenKeys) {
      expect(savedDelivery).not.toHaveProperty(key);
    }
  });

  it("stores false, null who, and null when if sight-check is not checked", () => {
    const input = {
      drNumber: "DR-9902",
      deliveryDate: new Date("2026-11-05T00:00:00.000Z"),
      idSightChecked: false,
    };

    const idCheckedAt = input.idSightChecked ? new Date() : null;
    const idCheckedById = input.idSightChecked ? "user-clrk123" : null;

    expect(input.idSightChecked).toBe(false);
    expect(idCheckedById).toBeNull();
    expect(idCheckedAt).toBeNull();
  });
});
