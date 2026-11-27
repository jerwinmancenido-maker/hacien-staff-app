// Store-order refund / chargeback mirror (store intake Slice 3,
// HIGH RISK — money (voids)).
//
// A converted store order is unwound by running the EXISTING void
// services in dependency order — voidCollection → voidBilling →
// voidSalesOrder → voidExpense (the gateway fee expense) — each in its
// own transaction, with its own gates and guards (period-open,
// received-2307, live-children). The sequence is deliberately NOT one
// transaction (Slice 2's conversion is; this mirror is not): every void
// is atomic, audited and snapshot-backed via DocumentVoid, and the
// mirror is RESUMABLE — steps already void are skipped, so a sequence
// stopped by a guard (a closed period, a received 2307) is finished by
// running it again, never by hand-editing. The store order's terminal
// status (REFUNDED / CHARGEBACK) is set only when every step reads
// void, in the same transaction as its audit row.
//
// Progress is DERIVED from the linked documents' own statuses — there
// is no progress column to drift. The fee expense is found by its exact
// conversion fingerprint (SO link + account-less + the notes sentence
// conversion writes), so the mirror voids only that expense, never
// other SO-linked expenses such as freight.

import type { StoreOrderStatus } from "@prisma/client";
import { db } from "../db";
import { writeAudit } from "../audit";
import { assertCan, type PermissionUser } from "../permissions";
import { DocRuleError, money } from "../documents/common";
import { voidReasonSchema } from "../validation/quotes";
import { voidCollection } from "../services/collections";
import { voidBilling } from "../services/billings";
import { voidSalesOrder } from "../services/sales-orders";
import { voidExpense } from "../services/expenses";

export type StoreOrderRefundKind = "REFUNDED" | "CHARGEBACK";

export type StoreOrderRefundActor = PermissionUser & { id: string };

export type StoreOrderMirrorStep = {
  key: "collection" | "billing" | "salesOrder" | "feeExpense";
  label: string;
  docId: string;
  docNumber: string;
  href: string;
  status: string;
  /** True when the document already reads VOID (nothing left to do). */
  done: boolean;
};

export type StoreOrderMirrorState = {
  orderId: string;
  number: string;
  status: StoreOrderStatus;
  gatewayName: string;
  gatewayPaymentRef: string;
  gatewayFee: string;
  salesOrderId: string | null;
  /** Steps in execution order: collections, billings, the SO, the fee expense. */
  steps: StoreOrderMirrorStep[];
  doneCount: number;
  totalCount: number;
  /** Every step void — the mirror has nothing left to run. */
  complete: boolean;
};

/** The exact notes sentence conversion writes on the gateway fee expense. */
export function gatewayFeeExpenseNotes(orderNumber: string, gatewayPaymentRef: string): string {
  return `Gateway fee withheld from settlement - web order ${orderNumber}, payment ref ${gatewayPaymentRef}.`;
}

/**
 * The conversion-created gateway fee expense for a store order, found by
 * its full fingerprint: linked to the SO, account-less (the fee was
 * withheld from settlement), payee = the gateway, and the exact notes
 * sentence. Null when the order had no fee (or no expense was created).
 */
async function findGatewayFeeExpense(order: {
  salesOrderId: string;
  number: string;
  gatewayName: string;
  gatewayPaymentRef: string;
}) {
  return db.expense.findFirst({
    where: {
      salesOrderId: order.salesOrderId,
      cashAccountId: null,
      payeeText: order.gatewayName,
      notes: gatewayFeeExpenseNotes(order.number, order.gatewayPaymentRef),
    },
    select: { id: true, number: true, status: true },
  });
}

/**
 * The mirror's live state for one store order: the linked documents in
 * unwind order, each with its own status. Drives the detail page's
 * progress display and the refund service's skip-if-void sequence.
 */
export async function getStoreOrderMirrorState(id: string): Promise<StoreOrderMirrorState | null> {
  const order = await db.storeOrder.findUnique({
    where: { id },
    select: {
      id: true,
      number: true,
      status: true,
      gatewayName: true,
      gatewayPaymentRef: true,
      gatewayFee: true,
      salesOrderId: true,
    },
  });
  if (!order) return null;

  const steps: StoreOrderMirrorStep[] = [];
  if (order.salesOrderId) {
    const [so, billings] = await Promise.all([
      db.salesOrder.findUnique({
        where: { id: order.salesOrderId },
        select: { id: true, number: true, status: true },
      }),
      db.billing.findMany({
        where: { salesOrderId: order.salesOrderId },
        select: { id: true, number: true, status: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const billingIds = billings.map((b) => b.id);
    const allocations = billingIds.length
      ? await db.collectionAllocation.findMany({
          where: { billingId: { in: billingIds } },
          select: { collection: { select: { id: true, number: true, status: true, createdAt: true } } },
        })
      : [];
    const collectionsById = new Map<string, { id: string; number: string; status: string; createdAt: Date }>();
    for (const a of allocations) {
      if (!collectionsById.has(a.collection.id)) collectionsById.set(a.collection.id, a.collection);
    }
    const collections = [...collectionsById.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    for (const c of collections) {
      steps.push({
        key: "collection",
        label: "Collection",
        docId: c.id,
        docNumber: c.number,
        href: `/billing/collections/${c.id}`,
        status: c.status,
        done: c.status === "VOID",
      });
    }
    for (const b of billings) {
      steps.push({
        key: "billing",
        label: "Billing",
        docId: b.id,
        docNumber: b.number,
        href: `/billing/billings/${b.id}`,
        status: b.status,
        done: b.status === "VOID",
      });
    }
    if (so) {
      steps.push({
        key: "salesOrder",
        label: "Sales order",
        docId: so.id,
        docNumber: so.number,
        href: `/sales-orders/${so.id}`,
        status: so.status,
        done: so.status === "VOID",
      });
    }
    const fee = await findGatewayFeeExpense({
      salesOrderId: order.salesOrderId,
      number: order.number,
      gatewayName: order.gatewayName,
      gatewayPaymentRef: order.gatewayPaymentRef,
    });
    if (fee) {
      steps.push({
        key: "feeExpense",
        label: "Gateway fee expense",
        docId: fee.id,
        docNumber: fee.number,
        href: `/cash/expenses/${fee.id}`,
        status: fee.status,
        done: fee.status === "VOID",
      });
    }
  }

  const doneCount = steps.filter((s) => s.done).length;
  return {
    orderId: order.id,
    number: order.number,
    status: order.status,
    gatewayName: order.gatewayName,
    gatewayPaymentRef: order.gatewayPaymentRef,
    gatewayFee: money(order.gatewayFee),
    salesOrderId: order.salesOrderId,
    steps,
    doneCount,
    totalCount: steps.length,
    complete: steps.length > 0 && doneCount === steps.length,
  };
}

/**
 * Run (or resume) the refund/chargeback mirror for a converted store
 * order. Gate: manage_billing (Admin/Approver) — the void services'
 * own gate; a reason is required and is passed to every void, so each
 * DocumentVoid snapshot carries it. A step's guard error stops the
 * sequence and surfaces unchanged; the steps already voided stay void
 * and the next run skips them. The terminal status + its audit row are
 * written only once the whole chain reads void.
 */
export async function refundStoreOrder(
  id: string,
  input: { kind: StoreOrderRefundKind; reason: string },
  actor: StoreOrderRefundActor,
) {
  assertCan(actor, "manage_billing");
  if (input.kind !== "REFUNDED" && input.kind !== "CHARGEBACK") {
    throw new DocRuleError("Pick whether this is a refund or a chargeback.", "kind");
  }
  const parsedReason = voidReasonSchema.safeParse(input.reason);
  if (!parsedReason.success) {
    throw new DocRuleError(parsedReason.error.issues[0]?.message ?? "A reason is required.", "reason");
  }
  const why = parsedReason.data;

  const order = await db.storeOrder.findUnique({
    where: { id },
    select: { id: true, number: true, status: true, gatewayName: true, gatewayPaymentRef: true, salesOrderId: true },
  });
  if (!order) throw new DocRuleError("Store order not found.");
  if (order.status === "REFUNDED" || order.status === "CHARGEBACK") {
    throw new DocRuleError(
      order.status === input.kind
        ? `This store order is already marked ${input.kind === "REFUNDED" ? "refunded" : "as a chargeback"}.`
        : "This store order already has a terminal refund/chargeback status.",
    );
  }
  if (!order.salesOrderId) {
    throw new DocRuleError(
      "This store order has not been converted yet — there are no documents to unwind. A refund or chargeback applies after conversion.",
    );
  }

  const before = await getStoreOrderMirrorState(id);
  if (!before || before.totalCount === 0) {
    throw new DocRuleError("The converted documents for this store order could not be found.");
  }

  // The plan's order: collection → billing → sales order → fee expense.
  // Each void service runs its own transaction and guards; a failure
  // stops the mirror here and the run can be resumed by calling again.
  for (const step of before.steps) {
    if (step.done) continue;
    if (step.key === "collection") await voidCollection(step.docId, why, actor);
    else if (step.key === "billing") await voidBilling(step.docId, why, actor);
    else if (step.key === "salesOrder") await voidSalesOrder(step.docId, why, actor);
    else await voidExpense(step.docId, why, actor);
  }

  const after = await getStoreOrderMirrorState(id);
  if (!after || !after.complete) {
    throw new DocRuleError("The mirror did not complete — check the linked documents and run it again.");
  }

  await db.$transaction(async (tx) => {
    await tx.storeOrder.update({ where: { id }, data: { status: input.kind } });
    await writeAudit(tx, {
      userId: actor.id,
      entityType: "StoreOrder",
      entityId: id,
      action: "update",
      before: { status: order.status },
      after: {
        number: order.number,
        status: input.kind,
        kind: input.kind === "REFUNDED" ? "refund" : "chargeback",
        gateway: order.gatewayName,
        paymentRef: order.gatewayPaymentRef,
        reason: why,
        voided: after.steps.map((s) => s.docNumber),
      },
      diff: false,
    });
  });

  return { status: input.kind, salesOrderId: order.salesOrderId };
}

/**
 * Staff-set PROVISIONING (Slice 3): a converted subscription order is
 * being fulfilled (manually against the gateway/publisher portal until
 * the Crayon connector's polling exists). Plain status action, gate
 * edit_data. DONE is never set here — it is derived from the linked
 * SO's CLOSED status.
 */
export async function markStoreOrderProvisioning(id: string, actor: StoreOrderRefundActor) {
  assertCan(actor, "edit_data");
  const order = await db.storeOrder.findUnique({
    where: { id },
    select: { id: true, number: true, status: true },
  });
  if (!order) throw new DocRuleError("Store order not found.");
  if (order.status === "PROVISIONING") {
    throw new DocRuleError("This store order is already marked Provisioning.");
  }
  if (order.status !== "CONFIRMED") {
    throw new DocRuleError("Only a converted store order can be marked Provisioning.");
  }
  await db.$transaction(async (tx) => {
    await tx.storeOrder.update({ where: { id }, data: { status: "PROVISIONING" } });
    await writeAudit(tx, {
      userId: actor.id,
      entityType: "StoreOrder",
      entityId: id,
      action: "update",
      before: { status: order.status },
      after: { number: order.number, status: "PROVISIONING" },
      diff: false,
    });
  });
  return { status: "PROVISIONING" as const };
}
