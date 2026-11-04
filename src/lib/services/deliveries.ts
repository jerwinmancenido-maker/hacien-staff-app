// Sales order delivery records (DR number from BIR delivery receipt booklet).
// Cumulative delivered quantity can never exceed ordered quantity.
// ID sight-checked is stored ONLY as boolean + checked-by user id + timestamp.
// NEVER stores ID type, number or photo.

import { db, type Tx } from "../db";
import { writeAudit } from "../audit";
import { assertCan, assertCanVoid, type PermissionUser } from "../permissions";
import { bookletRangeError, formatBookletNumber, parseBookletSerial } from "../billing/booklet";
import { DocRuleError, DOC_TX, money, withTxRetry, ymd } from "../documents/common";
import { applyDelivery, checkDelivery, type OpenDeliveryLine } from "../sales-orders/delivery";
import { getSettingsSnapshot } from "../settings";
import type { DeliveryInput } from "../validation/deliveries";
import { voidReasonSchema } from "../validation/quotes";
import { createAttachments, discardUploads, prepareUploads, type UploadFile } from "./attachments";
import { notifyOrderDelivered } from "../messaging/order-text-triggers";
import { claimBookletSerial } from "./booklet";

export type DeliveryActor = PermissionUser & { id: string };

type LockedLine = { id: string; description: string; qty: string; deliveredQty: string };

async function lockSalesOrderRow(
  tx: Tx,
  salesOrderId: string,
): Promise<{ id: string; status: string; number: string }> {
  const so = await tx.$queryRaw<{ id: string; status: string; number: string }[]>`SELECT \`id\`, \`status\`, \`number\` FROM \`SalesOrder\` WHERE \`id\` = ${salesOrderId} FOR UPDATE`;
  if (!so[0]) throw new DocRuleError("Sales order not found.");
  return so[0];
}

function mapLockedLines(
  rows: { id: string; description: string; qty: unknown; deliveredQty: unknown }[],
): LockedLine[] {
  return rows.map((r) => ({
    id: r.id,
    description: r.description,
    qty: money(String(r.qty)),
    deliveredQty: money(String(r.deliveredQty ?? 0)),
  }));
}

/** Lock live SO lines for recording a delivery (void SOs refused). */
async function lockForDelivery(
  tx: Tx,
  salesOrderId: string,
): Promise<{ status: string; number: string; lines: LockedLine[] }> {
  const so = await lockSalesOrderRow(tx, salesOrderId);
  if (so.status === "VOID") throw new DocRuleError("Cannot deliver on a void sales order.");

  const rows = await tx.$queryRaw<{ id: string; description: string; qty: unknown; deliveredQty: unknown }[]>`SELECT \`id\`, \`description\`, \`qty\`, \`deliveredQty\` FROM \`SalesOrderItem\` WHERE \`salesOrderId\` = ${salesOrderId} AND \`removedAt\` IS NULL ORDER BY \`sortOrder\` FOR UPDATE`;
  return { status: so.status, number: so.number, lines: mapLockedLines(rows) };
}

/**
 * Lock the delivery's SO item rows for void — including removed lines, and
 * even when the sales order is already void (so deliveredQty can still reverse).
 */
async function lockLinesForVoidDelivery(
  tx: Tx,
  salesOrderId: string,
  itemIds: readonly string[],
): Promise<{ status: string; number: string; lines: LockedLine[] }> {
  const so = await lockSalesOrderRow(tx, salesOrderId);
  const lines: LockedLine[] = [];
  for (const itemId of itemIds) {
    const rows = await tx.$queryRaw<{ id: string; description: string; qty: unknown; deliveredQty: unknown }[]>`SELECT \`id\`, \`description\`, \`qty\`, \`deliveredQty\` FROM \`SalesOrderItem\` WHERE \`id\` = ${itemId} AND \`salesOrderId\` = ${salesOrderId} FOR UPDATE`;
    if (rows[0]) lines.push(...mapLockedLines(rows));
  }
  return { status: so.status, number: so.number, lines };
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
  const drRaw = input.drNumber.trim();
  const drSerial = parseBookletSerial(drRaw);
  if (drSerial == null) {
    throw new DocRuleError("Enter a whole booklet DR number (digits, optional DR prefix).", "drNumber");
  }
  const snap = await getSettingsSnapshot();
  const drRange = snap.settings.invoiceBooklet.deliveryReceipt;
  const drRangeErr = bookletRangeError(drSerial, drRange, "DR");
  if (drRangeErr) throw new DocRuleError(drRangeErr, "drNumber");

  const uploads = await prepareUploads(files);

  try {
    // Q16 S-95: order text AFTER the delivery transaction commits, never
    // inside it, so a text failure can never roll back the delivery.
    const delivery = await withTxRetry(() =>
      db.$transaction(async (tx) => {
        const so = await lockForDelivery(tx, salesOrderId);
        const check = checkDelivery(so.lines as OpenDeliveryLine[], input.items);
        if (!check.ok) {
          const firstId = Object.keys(check.errors)[0];
          throw new DocRuleError(
            firstId ? (check.errors[firstId] ?? check.message) : check.message,
            firstId ? `items.${firstId}` : undefined,
          );
        }

        // Gap-lock spoiled unique key, then refuse any existing DR (incl. voided).
        await tx.$queryRaw`SELECT \`id\` FROM \`SpoiledBookletNumber\` WHERE \`type\` = 'DR' AND \`number\` = ${drSerial} FOR UPDATE`;
        const spoiled = await tx.spoiledBookletNumber.findFirst({
          where: { type: "DR", number: drSerial },
          select: { id: true },
        });
        const deliveries = await tx.delivery.findMany({ select: { drNumber: true } });
        const taken = deliveries.some((d) => parseBookletSerial(d.drNumber) === drSerial);
        if (spoiled || taken) {
          throw new DocRuleError(
            `DR no. ${formatBookletNumber(drSerial)} is already used / marked spoiled.`,
            "drNumber",
          );
        }
        await claimBookletSerial(tx, "DR", drSerial);

        const now = new Date();
        const idCheckedAt = input.idSightChecked ? now : null;
        const idCheckedById = input.idSightChecked ? actor.id : null;

        const delivery = await tx.delivery.create({
          data: {
            salesOrderId,
            drNumber: drRaw,
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
    await notifyOrderDelivered(salesOrderId, delivery.id, actor.id);
    return delivery;
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
      // Lock the delivery row first so concurrent voids cannot both reverse qty.
      await tx.$queryRaw`SELECT \`id\` FROM \`Delivery\` WHERE \`id\` = ${id} FOR UPDATE`;
      const delivery = await tx.delivery.findUnique({
        where: { id },
        include: { items: true, salesOrder: true },
      });
      if (!delivery) throw new DocRuleError("Delivery record not found.");
      if (delivery.voidedAt) throw new DocRuleError("This delivery is already void.");

      const itemIds = delivery.items.map((i) => i.salesOrderItemId);
      const so = await lockLinesForVoidDelivery(tx, delivery.salesOrderId, itemIds);
      const byId = new Map(so.lines.map((l) => [l.id, l]));

      for (const item of delivery.items) {
        const line = byId.get(item.salesOrderItemId);
        if (!line) {
          throw new DocRuleError("A line of this delivery is missing from the sales order.");
        }
        line.deliveredQty = applyDelivery(line, money(item.qty), -1);
        await tx.salesOrderItem.update({
          where: { id: line.id },
          data: { deliveredQty: line.deliveredQty },
        });
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
