// Read-only loaders for Books registers. Builds book rows from existing
// billings, collections, supplier bills, supplier payments, and expenses.
// Never computes VAT / input tax. Voided records are marked so builders drop them.

import { assertCan, type PermissionUser } from "../permissions";
import { money } from "../documents/common";
import { fromScaled, toScaled } from "../quotes/calc";
import { db } from "../db";
import { isCashEnabled } from "../cash/features";
import { isPayablesEnabled } from "../payables/features";
import type { BookSourceRow } from "../books/registers";
import { manilaYmdFromInstant } from "../books/period";
import type { RegisterKey } from "../books/config";
import { REGISTER_CONFIGS } from "../books/config";
import { buildRegister, DELETED_VOID_PARTICULARS_PREFIX, type BookRegister } from "../books/registers";

function deletedVoidSiRow(billingId: string, snapRaw: unknown): BookSourceRow | null {
  if (!snapRaw || typeof snapRaw !== "object" || Array.isArray(snapRaw)) return null;
  const snap = snapRaw as Record<string, unknown>;
  const invoiceNo = snap.invoiceNo;
  const date = snap.invoiceDate;
  if (invoiceNo == null || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const inv = `INV-${invoiceNo}`;
  const party = typeof snap.customer === "string" && snap.customer.trim() ? snap.customer.trim() : "—";
  return {
    id: `deleted-${billingId}`,
    kind: "BILLING",
    date,
    documentNumber: inv,
    party,
    particulars: `${DELETED_VOID_PARTICULARS_PREFIX}, SI no. ${inv}`,
    amount: "0.00",
    ewt: null,
    href: null,
    voided: true,
  };
}

function dateYmd(d: Date): string {
  // DATE columns are UTC midnight of the Manila calendar day; manilaYmdFromInstant
  // also correctly maps real UTC timestamps (23:59 PHT in, 00:00 next day out).
  return manilaYmdFromInstant(d);
}

function sumEwt(allocs: { withholdingApplied: { toFixed(n: number): string } | string | number }[]): string {
  const total = allocs.reduce((a, x) => a + toScaled(money(x.withholdingApplied), 2), 0n);
  return fromScaled(total, 2);
}

/** All source rows that can feed any register (caller filters by kind/period). */
export async function listBookSourceRows(actor: PermissionUser): Promise<BookSourceRow[]> {
  assertCan(actor, "view_books");
  // Do not link into gated sections when their feature flags are off.
  const [cashOn, payablesOn] = await Promise.all([isCashEnabled(), isPayablesEnabled()]);

  // Business-entity wall (PR-B, 2026-11-19): the Books are HACIEN's books.
  // Documents tagged to another business (businessId non-null on their
  // SO / PO / the expense itself) never appear here — they are summarised
  // separately by getHeldForOthers. Collections stay unfiltered on purpose:
  // allocations can only reach HACIEN billings (a tagged SO cannot be
  // billed), and an unallocated deposit carries no deal link to attribute.
  const [billings, collections, bills, payments, expenses, deletedBillingAudits] = await Promise.all([
    db.billing.findMany({
      where: { salesOrder: { businessId: null } },
      include: { customer: { select: { name: true } } },
      orderBy: [{ invoiceDate: "asc" }, { invoiceNo: "asc" }],
    }),
    db.collection.findMany({
      include: {
        customer: { select: { name: true } },
        allocations: { select: { withholdingApplied: true, billing: { select: { number: true } } } },
      },
      orderBy: [{ date: "asc" }, { number: "asc" }],
    }),
    db.supplierBill.findMany({
      where: { OR: [{ purchaseOrderId: null }, { purchaseOrder: { businessId: null } }] },
      include: { supplier: { select: { name: true } } },
      orderBy: [{ billDate: "asc" }, { billNumber: "asc" }],
    }),
    db.supplierPayment.findMany({
      include: {
        supplier: { select: { name: true } },
        allocations: {
          select: {
            withholdingApplied: true,
            supplierBill: { select: { billNumber: true, purchaseOrder: { select: { businessId: true } } } },
          },
        },
      },
      orderBy: [{ date: "asc" }, { number: "asc" }],
    }),
    db.expense.findMany({
      where: { businessId: null },
      include: {
        supplier: { select: { name: true } },
        category: { select: { label: true } },
      },
      orderBy: [{ date: "asc" }, { number: "asc" }],
    }),
    db.auditLog.findMany({
      where: { entityType: "Billing", action: "delete" },
      select: { id: true, entityId: true, before: true, after: true },
      orderBy: { at: "asc" },
    }),
  ]);

  const rows: BookSourceRow[] = [];

  for (const b of billings) {
    const inv = `INV-${b.invoiceNo}`;
    rows.push({
      id: b.id,
      kind: "BILLING",
      date: dateYmd(b.invoiceDate),
      documentNumber: inv,
      party: b.customer.name,
      particulars: b.notes?.trim() || `Sales invoice ${inv} (${b.number})`,
      amount: money(b.amount),
      ewt: money(b.withholdingExpected),
      href: `/billing/billings/${b.id}`,
      voided: b.status === "VOID",
    });
  }

  // A void SI that an Admin deleted is gone from Billing, but the number stays
  // on the register. Amount is 0 so it does not re-enter the invoiced total
  // (the void already had no legal effect). The wording comes from the delete
  // audit snapshot. No link — the document page is gone.
  for (const audit of deletedBillingAudits) {
    if (!audit.entityId) continue;
    const line = deletedVoidSiRow(audit.entityId, audit.before ?? audit.after);
    if (line) rows.push(line);
  }

  for (const c of collections) {
    const ewt = sumEwt(c.allocations);
    const method = c.method.replace(/_/g, " ").toLowerCase();
    const bits = [`Collection ${method}`];
    if (c.receiptNo) bits.push(`OR ${c.receiptNo}`);
    if (c.reference) bits.push(`Ref ${c.reference}`);
    // Name the billings this collection (and its EWT) belongs to, so the
    // EWT column reads as per-billing rather than one lump on the row.
    const billed = [...new Set(c.allocations.map((a) => a.billing.number))];
    if (billed.length) bits.push(`for ${billed.join(", ")}`);
    rows.push({
      id: c.id,
      kind: "COLLECTION",
      date: dateYmd(c.date),
      documentNumber: c.number,
      party: c.customer.name,
      particulars: bits.join(" · "),
      amount: money(c.amountReceived),
      ewt,
      href: `/billing/collections/${c.id}`,
      voided: c.status === "VOID",
    });
  }

  for (const b of bills) {
    rows.push({
      id: b.id,
      kind: "SUPPLIER_BILL",
      date: dateYmd(b.billDate),
      documentNumber: b.billNumber,
      party: b.supplier.name,
      particulars: b.notes?.trim() || "Supplier bill",
      amount: money(b.amount),
      ewt: null,
      href: b.purchaseOrderId ? `/purchase-orders/${b.purchaseOrderId}` : `/suppliers/${b.supplierId}`,
      voided: b.status === "VOID",
    });
  }

  for (const p of payments) {
    // Entity wall: a payment whose allocated bills ALL belong to another
    // business is that business's money, not HACIEN's. A mixed payment
    // (at least one HACIEN or standalone bill) stays — payment amounts
    // are not split per bill in the registers.
    if (p.allocations.length > 0 && p.allocations.every((a) => a.supplierBill.purchaseOrder?.businessId)) continue;
    const ewt = sumEwt(p.allocations);
    const method = p.method.replace(/_/g, " ").toLowerCase();
    const bits = [`Payment ${method}`];
    if (p.reference) bits.push(`Ref ${p.reference}`);
    const paid = [...new Set(p.allocations.map((a) => a.supplierBill.billNumber))];
    if (paid.length) bits.push(`for ${paid.join(", ")}`);
    rows.push({
      id: p.id,
      kind: "SUPPLIER_PAYMENT",
      date: dateYmd(p.date),
      documentNumber: p.number,
      party: p.supplier.name,
      particulars: bits.join(" · "),
      amount: money(p.amountPaid),
      ewt,
      href: payablesOn ? `/payables/payments/${p.id}` : null,
      voided: p.status === "VOID",
    });
  }

  for (const e of expenses) {
    const party = e.supplier?.name ?? e.payeeText ?? "—";
    const bits = [e.category.label];
    if (e.receiptNo) bits.push(`Receipt ${e.receiptNo}`);
    if (e.notes?.trim()) bits.push(e.notes.trim());
    rows.push({
      id: e.id,
      kind: "EXPENSE",
      date: dateYmd(e.date),
      documentNumber: e.number,
      party,
      particulars: bits.join(" · "),
      amount: money(e.amount),
      ewt: money(e.withholdingApplied),
      href: cashOn ? `/cash/expenses/${e.id}` : null,
      voided: e.status === "VOID",
    });
  }

  return rows;
}

export async function getBookRegister(
  actor: PermissionUser,
  key: RegisterKey,
  fromYmd: string,
  toYmd: string,
): Promise<{ config: (typeof REGISTER_CONFIGS)[RegisterKey]; register: BookRegister }> {
  assertCan(actor, "view_books");
  const config = REGISTER_CONFIGS[key];
  const sources = await listBookSourceRows(actor);
  return { config, register: buildRegister(config, sources, fromYmd, toYmd) };
}

export type HeldForOthers = {
  billsRecorded: string;
  billsCount: number;
  paymentsMade: string;
  paymentsCount: number;
  expensesRecorded: string;
  expensesCount: number;
  /** All-time unpaid balance on other businesses' supplier bills. */
  stillOwed: string;
};

/**
 * The other side of the entity wall (PR-B): money recorded in this app for
 * OTHER businesses (tagged documents), summarised so the cash in the bank
 * still reconciles — bank balance = HACIEN's books + held for others.
 * Period figures use each document's own date; `stillOwed` is all-time.
 * Customer-side money is not here: collections carry no deal link (see
 * listBookSourceRows), so a deposit cannot be attributed to a business.
 */
export async function getHeldForOthers(actor: PermissionUser, fromYmd: string, toYmd: string): Promise<HeldForOthers> {
  assertCan(actor, "view_books");
  const from = new Date(`${fromYmd}T00:00:00.000Z`);
  const to = new Date(`${toYmd}T00:00:00.000Z`);
  const taggedBillWhere = { purchaseOrder: { businessId: { not: null } } } as const;

  const [bills, payments, expenses, owedBills] = await Promise.all([
    db.supplierBill.findMany({
      where: { ...taggedBillWhere, status: { not: "VOID" }, billDate: { gte: from, lte: to } },
      select: { amount: true },
    }),
    db.supplierPayment.findMany({
      where: { status: "POSTED", date: { gte: from, lte: to } },
      select: {
        amountPaid: true,
        allocations: { select: { supplierBill: { select: { purchaseOrder: { select: { businessId: true } } } } } },
      },
    }),
    db.expense.findMany({
      where: { businessId: { not: null }, status: "POSTED", date: { gte: from, lte: to } },
      select: { amount: true },
    }),
    db.supplierBill.findMany({
      where: { ...taggedBillWhere, status: { not: "VOID" } },
      select: {
        amount: true,
        allocations: {
          where: { supplierPayment: { status: "POSTED" } },
          select: { cashApplied: true, withholdingApplied: true },
        },
      },
    }),
  ]);

  const sum = (xs: readonly { amount: unknown }[]) => fromScaled(xs.reduce((a, x) => a + toScaled(money(x.amount as never), 2), 0n), 2);
  const taggedPayments = payments.filter(
    (p) => p.allocations.length > 0 && p.allocations.every((a) => a.supplierBill.purchaseOrder?.businessId),
  );
  let owed = 0n;
  for (const b of owedBills) {
    const paid = b.allocations.reduce(
      (a, x) => a + toScaled(money(x.cashApplied as never), 2) + toScaled(money(x.withholdingApplied as never), 2),
      0n,
    );
    const bal = toScaled(money(b.amount as never), 2) - paid;
    if (bal > 0n) owed += bal;
  }

  return {
    billsRecorded: sum(bills),
    billsCount: bills.length,
    paymentsMade: fromScaled(taggedPayments.reduce((a, p) => a + toScaled(money(p.amountPaid as never), 2), 0n), 2),
    paymentsCount: taggedPayments.length,
    expensesRecorded: sum(expenses),
    expensesCount: expenses.length,
    stillOwed: fromScaled(owed, 2),
  };
}
