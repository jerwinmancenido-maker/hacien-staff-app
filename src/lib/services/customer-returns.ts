// Audit D: goods a customer returns, with a credit memo for their value.
// Posting reduces the SO line's deliveredQty and creates customer credit
// for the returned value (qty x SO unit price), which can be applied to an
// open billing like unapplied collection cash. Voiding adds the quantities
// back and reverses any credit already applied. Same row-lock pattern as
// deliveries, so two returns at once can't over-return a line. A return on
// a CLOSED SO reopens it (refreshSalesOrderCloseState).
import { db, type Tx } from "../db";
import { writeAudit } from "../audit";
import { assertCan, assertCanVoid, type PermissionUser } from "../permissions";
import { allocateDocNumber, ensureSeries } from "../documents/series";
import { DocRuleError, DOC_TX, money, withTxRetry, ymd } from "../documents/common";
import { fromScaled, lineAmounts, toScaled } from "../quotes/calc";
import { applyDelivery } from "../sales-orders/delivery";
import { checkCustomerReturn } from "../sales-orders/returns";
import { refreshSalesOrderCloseState } from "./sales-orders";
import { recomputeBillingStatus } from "./billings";
import type { CustomerReturnInput } from "../validation/customer-returns";
import { voidReasonSchema } from "../validation/quotes";
import { assertPeriodOpen } from "./period-close";

export type CustomerReturnActor = PermissionUser & { id: string };

const RETURN_FORMAT = { prefix: "CM", padding: 4, resetYearly: true };

type LockedLine = {
  id: string;
  description: string;
  qty: string;
  deliveredQty: string;
  unitPrice: string;
};

async function lockForReturn(
  tx: Tx,
  salesOrderId: string,
): Promise<{ status: string; number: string; customerId: string; lines: LockedLine[] }> {
  const so = await tx.$queryRaw<{ id: string; status: string; number: string; customerId: string }[]>`SELECT \`id\`, \`status\`, \`number\`, \`customerId\` FROM \`SalesOrder\` WHERE \`id\` = ${salesOrderId} FOR UPDATE`;
  if (!so[0]) throw new DocRuleError("Sales order not found.");
  const rows = await tx.$queryRaw<{ id: string; description: string; qty: unknown; deliveredQty: unknown; unitPrice: unknown }[]>`SELECT \`id\`, \`description\`, \`qty\`, \`deliveredQty\`, \`unitPrice\` FROM \`SalesOrderItem\` WHERE \`salesOrderId\` = ${salesOrderId} AND \`removedAt\` IS NULL ORDER BY \`sortOrder\` FOR UPDATE`;
  return {
    status: so[0].status,
    number: so[0].number,
    customerId: so[0].customerId,
    lines: rows.map((r) => ({
      id: r.id,
      description: r.description,
      qty: money(String(r.qty)),
      deliveredQty: money(String(r.deliveredQty ?? 0)),
      unitPrice: money(String(r.unitPrice)),
    })),
  };
}

export async function postCustomerReturn(salesOrderId: string, input: CustomerReturnInput, actor: CustomerReturnActor) {
  assertCan(actor, "edit_data");
  const year = input.returnDate.getUTCFullYear();
  await ensureSeries(db, "CUSTOMER_RETURN", year, RETURN_FORMAT);
  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      const so = await lockForReturn(tx, salesOrderId);
      if (so.status === "VOID") throw new DocRuleError("Cannot return items on a void sales order.");
      await assertPeriodOpen(tx, input.returnDate);
      const check = checkCustomerReturn(so.lines, input.lines);
      if (!check.ok) throw new DocRuleError(check.message, "lines");
      const number = await allocateDocNumber(tx, "CUSTOMER_RETURN", year, RETURN_FORMAT);
      const byId = new Map(so.lines.map((l) => [l.id, l]));
      const items = check.entries.map((e) => {
        const line = byId.get(e.lineId)!;
        // Same qty x price math as the rest of the app (round half away from zero).
        const amount = lineAmounts({ kind: "GOODS", qty: e.qty, unitPrice: line.unitPrice, supplierUnitCost: "0" }).total;
        return { salesOrderItemId: e.lineId, qtyReturned: e.qty, unitPrice: line.unitPrice, amount };
      });
      const total = fromScaled(
        items.reduce((a, i) => a + toScaled(i.amount, 2), 0n),
        2,
      );
      const ret = await tx.customerReturn.create({
        data: {
          number,
          salesOrderId,
          returnDate: input.returnDate,
          reason: input.reason,
          createdById: actor.id,
          items: { create: items },
          credit: { create: { customerId: so.customerId, amount: total, createdById: actor.id } },
        },
        include: { items: true, credit: true },
      });
      for (const e of check.entries) {
        const line = byId.get(e.lineId)!;
        line.deliveredQty = applyDelivery(line, e.qty, -1);
        await tx.salesOrderItem.update({ where: { id: line.id }, data: { deliveredQty: line.deliveredQty } });
      }
      await refreshSalesOrderCloseState(tx, salesOrderId, actor.id);
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "CustomerReturn",
        entityId: ret.id,
        action: "create",
        after: {
          number,
          salesOrder: so.number,
          returnDate: ymd(input.returnDate),
          reason: input.reason,
          amount: total,
          items: check.entries.map((e) => ({ line: byId.get(e.lineId)!.description, qty: e.qty })),
        },
      });
      return ret;
    }, DOC_TX),
  );
}

export async function voidCustomerReturn(id: string, reason: string, actor: CustomerReturnActor) {
  assertCanVoid(actor);
  const parsed = voidReasonSchema.safeParse(reason);
  if (!parsed.success) throw new DocRuleError(parsed.error.issues[0]?.message ?? "Give a reason.");
  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      const ret = await tx.customerReturn.findUnique({
        where: { id },
        include: { items: true, credit: { include: { applications: true } } },
      });
      if (!ret) throw new DocRuleError("Return not found.");
      if (ret.status === "VOID") throw new DocRuleError("This return is already void.");
      const so = await lockForReturn(tx, ret.salesOrderId);
      await assertPeriodOpen(tx, ret.returnDate);
      const byId = new Map(so.lines.map((l) => [l.id, l]));
      for (const item of ret.items) {
        const line = byId.get(item.salesOrderItemId);
        if (!line) continue; // Line removed since; the return stays voided, quantities stay as-is.
        line.deliveredQty = applyDelivery(line, money(String(item.qtyReturned)), 1);
        await tx.salesOrderItem.update({ where: { id: line.id }, data: { deliveredQty: line.deliveredQty } });
      }
      // Reverse any credit already applied to billings, then recompute them.
      // No delete: the application rows stay as history, but every balance
      // sum only counts applications whose return is still POSTED — the
      // same pattern as voided collections (allocations stop counting once
      // their collection is VOID). Voiding the return un-applies the credit.
      const touchedBillings = [...new Set((ret.credit?.applications ?? []).map((a) => a.billingId))];
      await tx.customerReturn.update({ where: { id }, data: { status: "VOID", voidedAt: new Date(), voidReason: parsed.data } });
      for (const billingId of touchedBillings) await recomputeBillingStatus(tx, billingId, actor.id);
      await refreshSalesOrderCloseState(tx, ret.salesOrderId, actor.id);
      await writeAudit(tx, { userId: actor.id, entityType: "CustomerReturn", entityId: id, action: "void", after: { number: ret.number, reason: parsed.data } });
      return ret;
    }, DOC_TX),
  );
}

export async function listCustomerReturns(salesOrderId: string) {
  const rows = await db.customerReturn.findMany({
    where: { salesOrderId },
    include: {
      items: { include: { salesOrderItem: { select: { description: true } } } },
      credit: { include: { applications: true } },
    },
    orderBy: [{ returnDate: "desc" }, { createdAt: "desc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    returnDate: ymd(r.returnDate)!,
    reason: r.reason,
    status: r.status,
    voidReason: r.voidReason,
    amount: r.credit ? money(String(r.credit.amount)) : "0.00",
    creditApplied:
      r.status === "POSTED" && r.credit
        ? fromScaled(r.credit.applications.reduce((a, x) => a + toScaled(money(String(x.cashApplied)), 2), 0n), 2)
        : "0.00",
    items: r.items.map((i) => ({
      description: i.salesOrderItem.description,
      qtyReturned: money(String(i.qtyReturned)),
      unitPrice: money(String(i.unitPrice)),
      amount: money(String(i.amount)),
    })),
  }));
}

/** Unapplied return credit for a customer (POSTED returns only). */
export async function customerReturnCreditBalance(customerId: string): Promise<string> {
  const credits = await db.customerCredit.findMany({
    where: { customerId, customerReturn: { status: "POSTED" } },
    include: { applications: true },
  });
  let total = 0n;
  for (const c of credits) {
    const applied = c.applications.reduce((a, x) => a + toScaled(money(String(x.cashApplied)), 2), 0n);
    total += toScaled(money(String(c.amount)), 2) - applied;
  }
  return fromScaled(total, 2);
}
