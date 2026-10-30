// Read-only loaders for Books registers. Builds book rows from existing
// billings, collections, supplier bills, supplier payments, and expenses.
// Never computes VAT / input tax. Voided records are marked so builders drop them.

import { assertCan, type PermissionUser } from "../permissions";
import { money } from "../documents/common";
import { fromScaled, toScaled } from "../quotes/calc";
import { db } from "../db";
import { isCashEnabled } from "../cash/features";
import type { BookSourceRow } from "../books/registers";
import { manilaYmdFromInstant } from "../books/period";
import type { RegisterKey } from "../books/config";
import { REGISTER_CONFIGS } from "../books/config";
import { buildRegister, type BookRegister } from "../books/registers";

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
  // Expense detail lives under /cash — do not link there when CASH_ENABLED is off.
  const cashOn = await isCashEnabled();

  const [billings, collections, bills, payments, expenses] = await Promise.all([
    db.billing.findMany({
      include: { customer: { select: { name: true } } },
      orderBy: [{ invoiceDate: "asc" }, { invoiceNo: "asc" }],
    }),
    db.collection.findMany({
      include: {
        customer: { select: { name: true } },
        allocations: { select: { withholdingApplied: true } },
      },
      orderBy: [{ date: "asc" }, { number: "asc" }],
    }),
    db.supplierBill.findMany({
      include: { supplier: { select: { name: true } } },
      orderBy: [{ billDate: "asc" }, { billNumber: "asc" }],
    }),
    db.supplierPayment.findMany({
      include: {
        supplier: { select: { name: true } },
        allocations: { select: { withholdingApplied: true } },
      },
      orderBy: [{ date: "asc" }, { number: "asc" }],
    }),
    db.expense.findMany({
      include: {
        supplier: { select: { name: true } },
        category: { select: { label: true } },
      },
      orderBy: [{ date: "asc" }, { number: "asc" }],
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

  for (const c of collections) {
    const ewt = sumEwt(c.allocations);
    const method = c.method.replace(/_/g, " ").toLowerCase();
    const bits = [`Collection ${method}`];
    if (c.receiptNo) bits.push(`OR ${c.receiptNo}`);
    if (c.reference) bits.push(`Ref ${c.reference}`);
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
    const ewt = sumEwt(p.allocations);
    const method = p.method.replace(/_/g, " ").toLowerCase();
    const bits = [`Payment ${method}`];
    if (p.reference) bits.push(`Ref ${p.reference}`);
    rows.push({
      id: p.id,
      kind: "SUPPLIER_PAYMENT",
      date: dateYmd(p.date),
      documentNumber: p.number,
      party: p.supplier.name,
      particulars: bits.join(" · "),
      amount: money(p.amountPaid),
      ewt,
      href: `/payables/payments/${p.id}`,
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
