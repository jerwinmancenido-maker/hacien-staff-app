// Phase 3 #8b: supplier warranty claims, written against the receiving
// line (ReceivingReportItem). Supplier-side only: supplier, PO and
// serials are read through the receiving record at create time (W1).
//
// Rules (master plan Phase 3, scenarios W1-W3):
//  - A claim against a VOID receiving report is refused (W2).
//  - A second ACTIVE claim (OPEN / SENT_TO_SUPPLIER / APPROVED) on the
//    same receiving line + same serial is refused, naming the claim
//    that is already open (W3).
//  - Status moves follow WARRANTY_CLAIM_TRANSITIONS only.
//  - Create and every status change write their audit row in the same
//    transaction as the change itself.

import { db, type Tx } from "../db";
import { writeAudit } from "../audit";
import { assertCan, type PermissionUser } from "../permissions";
import { DocRuleError, withTxRetry, ymd } from "../documents/common";
import {
  canTransitionWarrantyClaim,
  isWarrantyClaimActive,
  sameClaimSerial,
  splitSerialNumbers,
  WARRANTY_CLAIM_STATUS_LABELS,
  type WarrantyClaimStatus,
} from "../purchasing/warranty-claims";
import type { CreateWarrantyClaimInput } from "../validation/warranty-claims";

export type WarrantyClaimActor = PermissionUser & { id: string };

type LockedReceivingItem = {
  id: string;
  serialNumbers: string | null;
  reportStatus: string;
  reportNumber: string;
  poNumber: string;
  supplierName: string;
};

/** Lock the receiving item row, then read its report / PO / supplier context. */
async function lockReceivingItem(tx: Tx, receivingReportItemId: string): Promise<LockedReceivingItem> {
  const rows = await tx.$queryRaw<
    { id: string; serialNumbers: string | null; reportStatus: string; reportNumber: string; poNumber: string; supplierName: string }[]
  >`SELECT i.\`id\` AS id, i.\`serialNumbers\` AS serialNumbers, r.\`status\` AS reportStatus, r.\`number\` AS reportNumber, po.\`number\` AS poNumber, s.\`name\` AS supplierName
    FROM \`ReceivingReportItem\` i
    JOIN \`ReceivingReport\` r ON r.\`id\` = i.\`receivingReportId\`
    JOIN \`PurchaseOrder\` po ON po.\`id\` = r.\`purchaseOrderId\`
    JOIN \`Supplier\` s ON s.\`id\` = po.\`supplierId\`
    WHERE i.\`id\` = ${receivingReportItemId} FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new DocRuleError("Receiving line not found.");
  return row;
}

export async function createWarrantyClaim(receivingReportItemId: string, input: CreateWarrantyClaimInput, actor: WarrantyClaimActor) {
  assertCan(actor, "edit_data");
  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      const item = await lockReceivingItem(tx, receivingReportItemId);
      // W2: no claims on a voided receiving report.
      if (item.reportStatus === "VOID") {
        throw new DocRuleError(`Receiving report ${item.reportNumber} is void, so a warranty claim cannot be filed on it.`);
      }
      // When the line recorded serials, the claimed serial must be one of them.
      const recorded = splitSerialNumbers(item.serialNumbers);
      const serial = input.serialNumber?.trim() ? input.serialNumber.trim() : null;
      if (serial && recorded.length > 0 && !recorded.some((s) => s.toLowerCase() === serial.toLowerCase())) {
        throw new DocRuleError(`Serial ${serial} is not one of the serials received on this line.`, "serialNumber");
      }
      // W3: one active claim per receiving line + serial.
      const existing = await tx.warrantyClaim.findMany({
        where: { receivingReportItemId },
        select: { id: true, serialNumber: true, status: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      });
      const blocker = existing.find((c) => isWarrantyClaimActive(c.status) && sameClaimSerial(c.serialNumber, serial));
      if (blocker) {
        throw new DocRuleError(
          `A warranty claim for this item${serial ? ` (serial ${serial})` : ""} is already ${WARRANTY_CLAIM_STATUS_LABELS[blocker.status]} — filed ${ymd(blocker.createdAt) ?? ""} (claim ${blocker.id}). Close or finish that claim first.`,
        );
      }
      const claim = await tx.warrantyClaim.create({
        data: {
          receivingReportItemId,
          serialNumber: serial,
          fault: input.fault,
          supplierRef: input.supplierRef,
          status: "OPEN",
          createdById: actor.id,
        },
      });
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "WarrantyClaim",
        entityId: claim.id,
        action: "create",
        after: {
          status: "OPEN",
          receivingReport: item.reportNumber,
          purchaseOrder: item.poNumber,
          supplier: item.supplierName,
          serialNumber: serial,
          fault: input.fault,
        },
        diff: false,
      });
      return claim;
    }),
  );
}

export async function changeWarrantyClaimStatus(claimId: string, to: WarrantyClaimStatus, actor: WarrantyClaimActor) {
  assertCan(actor, "edit_data");
  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; status: WarrantyClaimStatus }[]>`SELECT \`id\`, \`status\` FROM \`WarrantyClaim\` WHERE \`id\` = ${claimId} FOR UPDATE`;
      const claim = rows[0];
      if (!claim) throw new DocRuleError("Warranty claim not found.");
      if (claim.status === to) {
        throw new DocRuleError(`This claim is already ${WARRANTY_CLAIM_STATUS_LABELS[to]}.`);
      }
      if (!canTransitionWarrantyClaim(claim.status, to)) {
        throw new DocRuleError(
          `A ${WARRANTY_CLAIM_STATUS_LABELS[claim.status]} claim cannot move to ${WARRANTY_CLAIM_STATUS_LABELS[to]}.`,
        );
      }
      const updated = await tx.warrantyClaim.update({ where: { id: claimId }, data: { status: to } });
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "WarrantyClaim",
        entityId: claimId,
        action: "update",
        before: { status: claim.status },
        after: { status: to },
        diff: false,
      });
      return updated;
    }),
  );
}
