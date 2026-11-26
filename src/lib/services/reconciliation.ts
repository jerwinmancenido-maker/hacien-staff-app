// Reconciliation (Reconciliation Plan 2026-11-19, PR-C). Read-only views
// over existing documents: where the operational record and the official
// documents have not caught up with each other yet. Four gap lists:
//
//   1. Delivered, not billed        (sales orders)
//   2. Billed, not delivered        (sales orders)
//   3. Received, not invoiced — GRNI (purchase orders)
//   4. Bill recorded, not received  (supplier bills)
//
// Billings and supplier bills in this app are amount-based (no per-line
// allocation), so the lists work at document level: an SO is "delivered,
// not billed" when goods went out (a posted delivery exists) and the
// billed total is below the contract price. The lists change nothing —
// bringing a deal on-document later (create the billing / supplier bill
// from the existing SO / PO) closes its row automatically.
//
// The page is Admin-only (assertAdmin): it is the most sensitive summary
// in the app. Figures can be filtered per business (entity) — "own" is
// HACIEN (businessId NULL), "all" is every business combined.

import { writeAudit } from "../audit";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { db } from "../db";
import { DocRuleError, money } from "../documents/common";
import { assertCan, ForbiddenError, type PermissionUser } from "../permissions";
import { agingBucket, gapReasonLabel, isPoGapReason, isSoGapReason, type AgingBucket } from "../reconciliation-shared";
import { getSettingsSnapshot } from "../settings";
import { fromScaled, toScaled } from "../quotes/calc";
import { businessDisplayName } from "./businesses";
import { getMonthlyProfit } from "./profit";

export type ReconBusinessFilter = "all" | "own" | string;

export type ReconRow = {
  id: string;
  number: string;
  party: string;
  businessId: string | null;
  businessLabel: string | null;
  openedYmd: string;
  daysOpen: number;
  bucket: AgingBucket;
  amount: string;
  detail: string;
  gapReason: string | null;
  gapNote: string | null;
  href: string;
};

export type ReconList = { rows: ReconRow[]; total: string; count: number };

export type Reconciliation = {
  deliveredNotBilled: ReconList;
  billedNotDelivered: ReconList;
  receivedNotInvoiced: ReconList;
  billNotReceived: ReconList;
};

function assertAdmin(actor: PermissionUser): void {
  if (!actor.isAdmin) throw new ForbiddenError();
}

function businessWhere(filter: ReconBusinessFilter): { businessId?: string | null } {
  if (filter === "all") return {};
  if (filter === "own") return { businessId: null };
  return { businessId: filter };
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetween(opened: Date, asOf: Date): number {
  const a = Date.UTC(opened.getUTCFullYear(), opened.getUTCMonth(), opened.getUTCDate());
  const b = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

type MoneyLike = Parameters<typeof money>[0];
const sumMoney = (xs: readonly MoneyLike[]) => xs.reduce<bigint>((a, x) => a + toScaled(money(x), 2), 0n);
const sumQty = sumMoney;

export async function getReconciliation(
  actor: PermissionUser,
  filter: ReconBusinessFilter,
  asOf: Date = new Date(),
): Promise<Reconciliation> {
  assertAdmin(actor);
  const where = businessWhere(filter);
  const snap = await getSettingsSnapshot();
  const ownName = snap.settings.company.name;
  const labelOf = (b: { name: string; shortLabel: string } | null, businessId: string | null) =>
    businessId ? businessDisplayName(b, ownName) : null;

  const [sos, pos] = await Promise.all([
    db.salesOrder.findMany({
      where: { status: { not: "VOID" }, ...where },
      include: {
        customer: { select: { name: true } },
        business: { select: { name: true, shortLabel: true } },
        items: { where: { removedAt: null }, select: { qty: true } },
        deliveries: { where: { voidedAt: null }, select: { deliveryDate: true, items: { select: { qty: true } } } },
        billings: { where: { status: { not: "VOID" } }, select: { amount: true, invoiceDate: true } },
      },
      orderBy: [{ date: "asc" }, { number: "asc" }],
    }),
    db.purchaseOrder.findMany({
      where: { status: { not: "VOID" }, ...where },
      include: {
        supplier: { select: { name: true } },
        business: { select: { name: true, shortLabel: true } },
        items: { select: { id: true, unitCost: true } },
        receivingReports: {
          where: { status: "POSTED" },
          select: { receivedDate: true, items: { select: { purchaseOrderItemId: true, qtyReceived: true } } },
        },
        bills: {
          where: { status: { not: "VOID" } },
          select: { id: true, billNumber: true, amount: true, billDate: true },
        },
      },
      orderBy: [{ date: "asc" }, { number: "asc" }],
    }),
  ]);

  const deliveredNotBilled: ReconRow[] = [];
  const billedNotDelivered: ReconRow[] = [];
  for (const so of sos) {
    const deliveredQty = sumQty(so.deliveries.flatMap((d) => d.items.map((i) => i.qty)));
    const orderedQty = sumQty(so.items.map((i) => i.qty));
    const billed = sumMoney(so.billings.map((b) => b.amount));
    const contract = toScaled(money(so.contractPrice), 2);
    const base = {
      id: so.id,
      number: so.number,
      party: so.customer.name,
      businessId: so.businessId,
      businessLabel: labelOf(so.business, so.businessId),
      gapReason: gapReasonLabel(so.gapReasonCode),
      gapNote: so.gapNote,
      href: `/sales-orders/${so.id}`,
    };
    if (deliveredQty > 0n && billed < contract) {
      const opened = so.deliveries.reduce((min, d) => (d.deliveryDate < min ? d.deliveryDate : min), so.deliveries[0]!.deliveryDate);
      const daysOpen = daysBetween(opened, asOf);
      deliveredNotBilled.push({
        ...base,
        openedYmd: ymd(opened),
        daysOpen,
        bucket: agingBucket(daysOpen),
        amount: fromScaled(contract - billed, 2),
        detail: billed === 0n ? "Delivered — nothing billed yet" : "Delivered — billed in part",
      });
    }
    if (billed > 0n && deliveredQty < orderedQty) {
      const opened = so.billings.reduce((min, b) => (b.invoiceDate < min ? b.invoiceDate : min), so.billings[0]!.invoiceDate);
      const daysOpen = daysBetween(opened, asOf);
      billedNotDelivered.push({
        ...base,
        openedYmd: ymd(opened),
        daysOpen,
        bucket: agingBucket(daysOpen),
        amount: fromScaled(billed, 2),
        detail: deliveredQty === 0n ? "Billed — nothing delivered yet" : "Billed — delivered in part",
      });
    }
  }

  const receivedNotInvoiced: ReconRow[] = [];
  const billNotReceived: ReconRow[] = [];
  for (const po of pos) {
    const costByItem = new Map(po.items.map((i) => [i.id, toScaled(money(i.unitCost), 2)]));
    let receivedValue = 0n;
    for (const rr of po.receivingReports) {
      for (const item of rr.items) {
        const cost = costByItem.get(item.purchaseOrderItemId);
        if (cost !== undefined) receivedValue += (toScaled(money(item.qtyReceived), 2) * cost) / 100n;
      }
    }
    const billedTotal = sumMoney(po.bills.map((b) => b.amount));
    const base = {
      party: po.supplier.name,
      businessId: po.businessId,
      businessLabel: labelOf(po.business, po.businessId),
      gapReason: gapReasonLabel(po.gapReasonCode),
      gapNote: po.gapNote,
    };
    if (receivedValue > 0n && billedTotal < receivedValue && po.receivingReports.length > 0) {
      const opened = po.receivingReports.reduce((min, r) => (r.receivedDate < min ? r.receivedDate : min), po.receivingReports[0]!.receivedDate);
      const daysOpen = daysBetween(opened, asOf);
      receivedNotInvoiced.push({
        ...base,
        id: po.id,
        number: po.number,
        openedYmd: ymd(opened),
        daysOpen,
        bucket: agingBucket(daysOpen),
        amount: fromScaled(receivedValue - billedTotal, 2),
        detail: billedTotal === 0n ? "Received — no supplier bill recorded" : "Received — billed in part",
        href: `/purchase-orders/${po.id}`,
      });
    }
    for (const bill of po.bills) {
      const amount = toScaled(money(bill.amount), 2);
      if (amount > receivedValue) {
        const daysOpen = daysBetween(bill.billDate, asOf);
        billNotReceived.push({
          ...base,
          id: bill.id,
          number: bill.billNumber,
          openedYmd: ymd(bill.billDate),
          daysOpen,
          bucket: agingBucket(daysOpen),
          amount: fromScaled(amount - receivedValue, 2),
          detail: receivedValue === 0n ? `Bill on ${po.number} — nothing received yet` : `Bill on ${po.number} — received in part`,
          href: `/purchase-orders/${po.id}`,
        });
      }
    }
  }

  const toList = (rows: ReconRow[]): ReconList => ({
    rows,
    total: fromScaled(rows.reduce((a, r) => a + toScaled(r.amount, 2), 0n), 2),
    count: rows.length,
  });
  return {
    deliveredNotBilled: toList(deliveredNotBilled),
    billedNotDelivered: toList(billedNotDelivered),
    receivedNotInvoiced: toList(receivedNotInvoiced),
    billNotReceived: toList(billNotReceived),
  };
}

/** CSV for one reconciliation list (accountant export). */
export function reconciliationToCsv(title: string, list: ReconList): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const row = (xs: string[]) => xs.map(esc).join(",") + "\n";
  let out = row([title]);
  out += row(["Document", "Party", "Business", "Gap opened", "Days open", "Aging", "Amount", "Detail", "Reason", "Note"]);
  for (const r of list.rows) {
    out += row([
      r.number,
      r.party,
      r.businessLabel ?? "",
      r.openedYmd,
      String(r.daysOpen),
      r.bucket,
      r.amount,
      r.detail,
      r.gapReason ?? "",
      r.gapNote ?? "",
    ]);
  }
  out += row(["Total", "", "", "", "", "", list.total, `${list.count} open`]);
  return out;
}

// ---------------------------------------------------------------------------
// Gap reasons — facts about a document, recorded on the document.

export type GapReasonInput = { code: string | null; note: string | null };

/** E7: whether the gap-reason editor belongs on the document at all, and
 *  whether some billing already exists (the question wording follows).
 *  SO: a billing gap exists while billed < contract price. PO: a bill gap
 *  exists while posted receipts are worth more than the bills recorded —
 *  the same predicates as the reconciliation lists above. A document with
 *  no gap hides the editor instead of asking a stale question. */
export async function salesOrderGapState(id: string): Promise<{ show: boolean; partial: boolean }> {
  const so = await db.salesOrder.findUnique({
    where: { id },
    select: {
      contractPrice: true,
      billings: { where: { status: { not: "VOID" } }, select: { amount: true } },
    },
  });
  if (!so) return { show: false, partial: false };
  const billed = sumMoney(so.billings.map((b) => b.amount));
  return { show: billed < toScaled(money(so.contractPrice), 2), partial: billed > 0n };
}

export async function purchaseOrderGapState(id: string): Promise<{ show: boolean; partial: boolean }> {
  const po = await db.purchaseOrder.findUnique({
    where: { id },
    select: {
      items: { select: { id: true, unitCost: true } },
      receivingReports: {
        where: { status: "POSTED" },
        select: { items: { select: { purchaseOrderItemId: true, qtyReceived: true } } },
      },
      bills: { where: { status: { not: "VOID" } }, select: { amount: true } },
    },
  });
  if (!po) return { show: false, partial: false };
  const costByItem = new Map(po.items.map((i) => [i.id, toScaled(money(i.unitCost), 2)]));
  let receivedValue = 0n;
  for (const rr of po.receivingReports) {
    for (const item of rr.items) {
      const cost = costByItem.get(item.purchaseOrderItemId);
      if (cost !== undefined) receivedValue += (toScaled(money(item.qtyReceived), 2) * cost) / 100n;
    }
  }
  const billedTotal = sumMoney(po.bills.map((b) => b.amount));
  return { show: receivedValue > 0n && billedTotal < receivedValue, partial: billedTotal > 0n };
}

function validateGapReason(input: GapReasonInput, kind: "SO" | "PO"): { code: string | null; note: string | null } {
  const note = input.note?.trim() ? input.note.trim().slice(0, 2000) : null;
  if (!input.code) return { code: null, note: null };
  const ok = kind === "SO" ? isSoGapReason(input.code) : isPoGapReason(input.code);
  if (!ok) throw new DocRuleError("Pick a reason from the list.", "gapReasonCode");
  if (input.code === "OTHER" && !note) throw new DocRuleError("Write the note for an 'Other' reason.", "gapNote");
  return { code: input.code, note };
}

export async function setSalesOrderGapReason(id: string, input: GapReasonInput, actor: PermissionUser & { id: string }) {
  assertCan(actor, "edit_data");
  const { code, note } = validateGapReason(input, "SO");
  const before = await db.salesOrder.findUnique({ where: { id }, select: { gapReasonCode: true, gapNote: true } });
  if (!before) throw new DocRuleError("Sales order not found.");
  const after = await db.salesOrder.update({ where: { id }, data: { gapReasonCode: code, gapNote: note } });
  await writeAudit(db, {
    userId: actor.id,
    entityType: "SalesOrder",
    entityId: id,
    action: "update",
    before: { gapReasonCode: before.gapReasonCode, gapNote: before.gapNote },
    after: { gapReasonCode: code, gapNote: note },
  });
  return after;
}

export async function setPurchaseOrderGapReason(id: string, input: GapReasonInput, actor: PermissionUser & { id: string }) {
  assertCan(actor, "edit_data");
  const { code, note } = validateGapReason(input, "PO");
  const before = await db.purchaseOrder.findUnique({ where: { id }, select: { gapReasonCode: true, gapNote: true } });
  if (!before) throw new DocRuleError("Purchase order not found.");
  const after = await db.purchaseOrder.update({ where: { id }, data: { gapReasonCode: code, gapNote: note } });
  await writeAudit(db, {
    userId: actor.id,
    entityType: "PurchaseOrder",
    entityId: id,
    action: "update",
    before: { gapReasonCode: before.gapReasonCode, gapNote: before.gapNote },
    after: { gapReasonCode: code, gapNote: note },
  });
  return after;
}

// ---------------------------------------------------------------------------
// Operational profit — ALL recorded orders (billed or not), per business.
// This is a management view over the single set of records; it never feeds
// HACIEN's Books or tax figures (those stay billing-based — see
// getMonthlyProfit). The official billed revenue and net profit for the
// same month are returned alongside so the two are never confused.

export type OperationalProfitRow = {
  businessId: string | null;
  label: string;
  sales: string;
  supplierCosts: string;
  expenses: string;
  profit: string;
  orderCount: number;
};

export type OperationalProfitBridge = {
  /** Own-company recorded sales (the report's own-company row). */
  recordedSales: string;
  /** Own-company recorded profit — the bridge starts here. */
  recordedProfit: string;
  /** Recorded sales not in official billed revenue: recordedSales - officialBilledRevenue. */
  unbilled: string;
  /** Own-company recorded supplier costs (the report's own-company row). */
  recordedCosts: string;
  /** Supplier bills recorded in the month (Books, own company) — Monthly profit's own figure. */
  supplierBills: string;
  /** recordedCosts - supplierBills. */
  costsVsBills: string;
};

export type OperationalProfit = {
  month: string;
  rows: OperationalProfitRow[];
  combined: OperationalProfitRow;
  officialBilledRevenue: string;
  officialNet: string;
  /** Display-only walk from the own-company recorded profit to the
   *  official net (finding 1028, proposal P-A): recordedProfit - unbilled
   *  + costsVsBills = officialNet, exactly, in scaled centavos. Every
   *  input is a value this function or Monthly profit already computes —
   *  no new queries, no changed totals. */
  bridge: OperationalProfitBridge;
};

export async function getOperationalProfit(actor: PermissionUser, month: string): Promise<OperationalProfit> {
  assertCan(actor, "view_books");
  const parts = month.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));

  const [snap, orders, expenses, businesses, official] = await Promise.all([
    getSettingsSnapshot(),
    db.salesOrder.findMany({
      where: { status: { not: "VOID" }, date: { gte: from, lt: to } },
      select: { businessId: true, contractPrice: true, supplierCost: true },
    }),
    db.expense.findMany({
      where: { status: "POSTED", date: { gte: from, lt: to } },
      select: { businessId: true, amount: true },
    }),
    db.business.findMany({ select: { id: true, name: true, shortLabel: true }, orderBy: { sortOrder: "asc" } }),
    getMonthlyProfit(month),
  ]);

  const ownName = snap.settings.company.name;
  type Acc = { sales: bigint; costs: bigint; expenses: bigint; count: number };
  const blank = (): Acc => ({ sales: 0n, costs: 0n, expenses: 0n, count: 0 });
  const byKey = new Map<string, Acc>();
  const keyOf = (businessId: string | null) => businessId ?? "__own__";
  for (const o of orders) {
    const acc = byKey.get(keyOf(o.businessId)) ?? blank();
    acc.sales += toScaled(money(o.contractPrice), 2);
    acc.costs += toScaled(money(o.supplierCost), 2);
    acc.count += 1;
    byKey.set(keyOf(o.businessId), acc);
  }
  for (const e of expenses) {
    const acc = byKey.get(keyOf(e.businessId)) ?? blank();
    acc.expenses += toScaled(money(e.amount), 2);
    byKey.set(keyOf(e.businessId), acc);
  }

  const toRow = (businessId: string | null, label: string, acc: Acc): OperationalProfitRow => ({
    businessId,
    label,
    sales: fromScaled(acc.sales, 2),
    supplierCosts: fromScaled(acc.costs, 2),
    expenses: fromScaled(acc.expenses, 2),
    profit: fromScaled(acc.sales - acc.costs - acc.expenses, 2),
    orderCount: acc.count,
  });

  const rows: OperationalProfitRow[] = [toRow(null, ownName, byKey.get("__own__") ?? blank())];
  for (const b of businesses) {
    const acc = byKey.get(b.id);
    if (acc) rows.push(toRow(b.id, b.name, acc));
  }
  const total: Acc = blank();
  for (const acc of byKey.values()) {
    total.sales += acc.sales;
    total.costs += acc.costs;
    total.expenses += acc.expenses;
    total.count += acc.count;
  }
  const ownAcc = byKey.get("__own__") ?? blank();
  const bridge: OperationalProfitBridge = {
    recordedSales: fromScaled(ownAcc.sales, 2),
    recordedProfit: fromScaled(ownAcc.sales - ownAcc.costs - ownAcc.expenses, 2),
    unbilled: fromScaled(ownAcc.sales - toScaled(official.revenue, 2), 2),
    recordedCosts: fromScaled(ownAcc.costs, 2),
    supplierBills: official.supplierBills,
    costsVsBills: fromScaled(ownAcc.costs - toScaled(official.supplierBills, 2), 2),
  };
  return { month, rows, combined: toRow(null, "All businesses", total), officialBilledRevenue: official.revenue, officialNet: official.net, bridge };
}

export function operationalProfitToCsv(report: OperationalProfit, shortName: string = DEFAULT_SETTINGS.identity.appShortName): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const row = (xs: string[]) => xs.map(esc).join(",") + "\n";
  let out = row(["Operational profit — all recorded orders (not the official Books figure)", report.month]);
  out += row(["Business", "Orders", "Recorded sales", "Supplier costs", "Expenses", "Profit"]);
  for (const r of [...report.rows, report.combined]) {
    out += row([r.label, String(r.orderCount), r.sales, r.supplierCosts, r.expenses, r.profit]);
  }
  out += row([]);
  out += row([`Official billed revenue (Books, ${shortName} only)`, report.officialBilledRevenue]);
  out += row([`Official net profit (Books, ${shortName} only)`, report.officialNet]);
  out += row([]);
  out += row(["Bridge - recorded profit (own company)", report.bridge.recordedProfit]);
  out += row(["Bridge - less recorded sales not in official billed revenue", report.bridge.unbilled]);
  out += row(["Bridge - add supplier costs above supplier bills recorded", report.bridge.costsVsBills]);
  out += row([`Bridge - supplier bills recorded (Books, ${shortName} only)`, report.bridge.supplierBills]);
  return out;
}
