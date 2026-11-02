// Sales order delivery records (DR number from BIR delivery receipt booklet).
// Cumulative delivered quantity can never exceed ordered quantity.
// ID sight-checked is stored ONLY as boolean + checked-by user id + timestamp.
// NEVER stores ID type, number or photo.

import { db, type Tx } from "../db";
import { writeAudit } from "../audit";
import { assertCan, assertCanVoid, type PermissionUser } from "../permissions";
import { DocRuleError, DOC_TX, money, withTxRetry, ymd } from "../documents/common";
import { applyDelivery, checkDelivery, type OpenDeliveryLine } from "../sales-orders/delivery";
import type { DeliveryInput } from "../validation/deliveries";
import { voidReasonSchema } from "../validation/quotes";
import { createAttachments, discardUploads, prepareUploads, type UploadFile } from "./attachments";

export type DeliveryActor = PermissionUser & { id: string };

type LockedLine = { id: string; description: string; qty: string; deliveredQty: string };

async function lockForDelivery(
  tx: Tx,
  salesOrderId: string,
): Promise<{ status: string; number: string; lines: LockedLine[] }> {
  const so = await tx.$queryRaw<{ id: string; status: string; number: string }[]>`SELECT \`id\`, \`status\`, \`number\` FROM \`SalesOrder\` WHERE \`id\` = ${salesOrderId} FOR UPDATE`;
  if (!so[0]) throw new DocRuleError("Sales order not found.");
  if (so[0].status === "VOID") throw new DocRuleError("Cannot deliver on a void sales order.");

  const rows = await tx.$queryRaw<{ id: string; description: string; qty: unknown; deliveredQty: unknown }[]>`SELECT \`id\`, \`description\`, \`qty\`, \`deliveredQty\` FROM \`SalesOrderItem\` WHERE \`salesOrderId\` = ${salesOrderId} AND \`removedAt\` IS NULL ORDER BY \`sortOrder\` FOR UPDATE`;
  return {
    status: so[0].status,
    number: so[0].number,
    lines: rows.map((r) => ({
      id: r.id,
      description: r.description,
      qty: money(String(r.qty)),
      deliveredQty: money(String(r.deliveredQty ?? 0)),
    })),
  };
}

export async function recordDelivery(
  salesOrderId: string,
  input: DeliveryInput,
  actor: DeliveryActor,
  files: readonly UploadFile[] = [],
) {
  assertCan(actor, "edit_data");
  if (!input.drNumber || !input.drNumber.trim()) {
    throw new DocRuleError("DR number is required.", "drNumber");
  }

  const uploads = await prepareUploads(files);

  try {
    return await withTxRetry(() =>
      db.$transaction(async (tx) => {
        const so = await lockForDelivery(tx, salesOrderId);
        const check = checkDelivery(so.lines as OpenDeliveryLine[], input.items);
        if (!check.ok) {
          throw new DocRuleError(check.message, Object.keys(check.errors)[0]);
        }

        const now = new Date();
        const idCheckedAt = input.idSightChecked ? now : null;
        const idCheckedById = input.idSightChecked ? actor.id : null;

        const delivery = await tx.delivery.create({
          data: {
            salesOrderId,
            drNumber: input.drNumber.trim(),
            deliveryDate: input.deliveryDate,
            receivedBy: input.receivedBy ?? null,
            receivedDate: input.receivedDate ?? null,
            idSightChecked: input.idSightChecked === true,
            idCheckedById,
            idCheckedAt,
            createdById: actor.id,
            items: {
              create: check.entries.map((e) => ({
                salesOrderItemId: e.salesOrderItemId,
                qty: e.qty,
              })),
            },
          },
          include: { items: true },
        });

        const byId = new Map(so.lines.map((l) => [l.id, l]));
        for (const e of check.entries) {
          const line = byId.get(e.salesOrderItemId)!;
          line.deliveredQty = applyDelivery(line, e.qty, 1);
          await tx.salesOrderItem.update({
            where: { id: line.id },
            data: { deliveredQty: line.deliveredQty },
          });
        }

        await createAttachments(tx, uploads, { deliveryId: delivery.id }, actor.id);

        await writeAudit(tx, {
          userId: actor.id,
          entityType: "Delivery",
          entityId: delivery.id,
          action: "create",
          after: {
            drNumber: delivery.drNumber,
            salesOrder: so.number,
            deliveryDate: ymd(input.deliveryDate),
            receivedBy: input.receivedBy,
            receivedDate: ymd(input.receivedDate),
            idSightChecked: delivery.idSightChecked,
            items: check.entries.map((e) => ({
              line: byId.get(e.salesOrderItemId)!.description,
              qty: e.qty,
            })),
            attachments: uploads.length,
          },
        });

        return delivery;
      }, DOC_TX),
    );
  } catch (e) {
    await discardUploads(uploads);
    throw e;
  }
}

/** Void a delivery record: reverses delivered quantities on the SO items. */
export async function voidDelivery(id: string, reason: string, actor: DeliveryActor) {
  assertCanVoid(actor);
  const parsedReason = voidReasonSchema.safeParse(reason);
  if (!parsedReason.success) {
    throw new DocRuleError(parsedReason.error.issues[0]?.message ?? "A reason is required.", "reason");
  }

  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      const delivery = await tx.delivery.findUnique({
        where: { id },
        include: { items: true, salesOrder: true },
      });
      if (!delivery) throw new DocRuleError("Delivery record not found.");
      if (delivery.voidedAt) throw new DocRuleError("This delivery is already void.");

      const so = await lockForDelivery(tx, delivery.salesOrderId);
      const byId = new Map(so.lines.map((l) => [l.id, l]));

      for (const item of delivery.items) {
        const line = byId.get(item.salesOrderItemId);
        if (line) {
          line.deliveredQty = applyDelivery(line, money(item.qty), -1);
          await tx.salesOrderItem.update({
            where: { id: line.id },
            data: { deliveredQty: line.deliveredQty },
          });
        }
      }

      const now = new Date();
      const updated = await tx.delivery.update({
        where: { id },
        data: {
          voidedAt: now,
          voidReason: parsedReason.data,
        },
      });

      await writeAudit(tx, {
        userId: actor.id,
        entityType: "Delivery",
        entityId: id,
        action: "void",
        after: {
          voidedAt: now,
          voidReason: parsedReason.data,
        },
      });

      return updated;
    }, DOC_TX),
  );
}

export async function listSalesOrderDeliveries(salesOrderId: string) {
  return db.delivery.findMany({
    where: { salesOrderId },
    orderBy: [{ deliveryDate: "desc" }, { createdAt: "desc" }],
    include: {
      items: {
        include: { salesOrderItem: { select: { id: true, description: true, unit: true } } },
      },
      attachments: { where: { archivedAt: null }, orderBy: { createdAt: "desc" } },
      idCheckedBy: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });
}
