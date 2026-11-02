// "We owe" read model and pure calculations.
// Open (unpaid / partially paid, not voided) supplier bills sorted by due date ascending.
// All money math in scaled bigint (no floats).

import type { SupplierBillStatus, SupplierPaymentStatus } from "@prisma/client";
import { db } from "../db";
import { money, ymd } from "../documents/common";
import { fromScaled, toScaled } from "../quotes/calc";
import { billingToday, calendarDaysBetween } from "../billing/dates";
import { maskBankAccountNumber } from "../bank-mask";

export type WeOweDueLabel = "Overdue" | "Due this week" | null;

/**
 * Returns "Overdue" if due before today, "Due this week" if within 7 days (inclusive), else null.
 */
export function weOweDueLabel(dueDate: Date, today: Date = billingToday()): WeOweDueLabel {
  const days = calendarDaysBetween(today, dueDate);
  if (days < 0) return "Overdue";
  if (days <= 7) return "Due this week";
  return null;
}

export type WeOweBillInput = {
  id: string;
  billNumber: string;
  dueDate: Date;
  amount: unknown;
  status: SupplierBillStatus;
  supplier: {
    id: string;
    name: string;
    bankAccountNumber?: string | null;
  };
  purchaseOrder?: {
    id: string;
    number: string;
  } | null;
  allocations: {
    cashApplied: unknown;
    withholdingApplied: unknown;
    supplierPayment?: {
      status: SupplierPaymentStatus;
    } | null;
  }[];
};

export type WeOweRow = {
  id: string;
  billNumber: string;
  dueDate: Date;
  dueYmd: string;
  dueLabel: WeOweDueLabel;
  amount: string;
  paid: string;
  leftToPay: string;
  status: SupplierBillStatus;
  supplier: {
    id: string;
    name: string;
    bankAccountNumber?: string;
  };
  purchaseOrder: {
    id: string;
    number: string;
  } | null;
};

export type WeOweSummary = {
  rows: WeOweRow[];
  totalLeftToPay: string;
  totalAmount: string;
  totalPaid: string;
  count: number;
};

/**
 * Pure calculation for the "We owe" report.
 * - Voided bills are excluded.
 * - Voided payments are excluded from Paid and Left to pay.
 * - Fully paid bills (Left to pay <= 0) disappear from the list.
 * - Open bills are sorted by due date ascending.
 * - All math in scaled bigint (cents).
 */
export function computeWeOweRows(
  bills: readonly WeOweBillInput[],
  today: Date = billingToday(),
): WeOweSummary {
  const rows: WeOweRow[] = [];
  let totalLeftScaled = 0n;
  let totalAmountScaled = 0n;
  let totalPaidScaled = 0n;

  for (const b of bills) {
    if (b.status === "VOID") continue;

    let cashScaled = 0n;
    let whScaled = 0n;
    for (const a of b.allocations) {
      if (a.supplierPayment && a.supplierPayment.status !== "POSTED") continue;
      cashScaled += toScaled(money(a.cashApplied as never), 2);
      whScaled += toScaled(money(a.withholdingApplied as never), 2);
    }
    const paidScaled = cashScaled + whScaled;
    const amtScaled = toScaled(money(b.amount as never), 2);
    const leftScaled = amtScaled > paidScaled ? amtScaled - paidScaled : 0n;

    // Fully paid bills disappear from the list.
    if (leftScaled <= 0n || b.status === "PAID") continue;

    totalLeftScaled += leftScaled;
    totalAmountScaled += amtScaled;
    totalPaidScaled += paidScaled;

    rows.push({
      id: b.id,
      billNumber: b.billNumber,
      dueDate: b.dueDate,
      dueYmd: ymd(b.dueDate)!,
      dueLabel: weOweDueLabel(b.dueDate, today),
      amount: fromScaled(amtScaled, 2),
      paid: fromScaled(paidScaled, 2),
      leftToPay: fromScaled(leftScaled, 2),
      status: b.status,
      supplier: {
        id: b.supplier.id,
        name: b.supplier.name,
        ...(b.supplier.bankAccountNumber
          ? { bankAccountNumber: maskBankAccountNumber(b.supplier.bankAccountNumber) }
          : {}),
      },
      purchaseOrder: b.purchaseOrder ? { id: b.purchaseOrder.id, number: b.purchaseOrder.number } : null,
    });
  }

  rows.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.billNumber.localeCompare(b.billNumber));

  return {
    rows,
    totalLeftToPay: fromScaled(totalLeftScaled, 2),
    totalAmount: fromScaled(totalAmountScaled, 2),
    totalPaid: fromScaled(totalPaidScaled, 2),
    count: rows.length,
  };
}

export async function listWeOweBills(today: Date = billingToday()): Promise<WeOweSummary> {
  const bills = await db.supplierBill.findMany({
    where: {
      status: { in: ["RECORDED", "PARTIALLY_PAID"] },
    },
    include: {
      supplier: {
        select: { id: true, name: true, bankAccountNumber: true },
      },
      purchaseOrder: {
        select: { id: true, number: true },
      },
      allocations: {
        include: {
          supplierPayment: {
            select: { status: true },
          },
        },
      },
    },
    orderBy: [{ dueDate: "asc" }, { billDate: "asc" }],
  });

  return computeWeOweRows(bills, today);
}
