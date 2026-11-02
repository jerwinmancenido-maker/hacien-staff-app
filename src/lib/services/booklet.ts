// Pre-printed booklet service: track ATP booklets (SI, DR, CR) and record spoiled numbers.
// Numbers marked spoiled stay on record forever and can never be reused.

import type { BookletType } from "@prisma/client";
import { db, isUniqueViolation, type Tx } from "../db";
import { writeAudit } from "../audit";
import { assertCan, type PermissionUser } from "../permissions";
import { getSettingsSnapshot } from "../settings";
import { DocRuleError, DOC_TX, withTxRetry } from "../documents/common";
import { bookletRangeError, formatBookletNumber, parseBookletSerial } from "../billing/booklet";
import { createAttachments, discardUploads, prepareUploads, type UploadFile } from "./attachments";

export type BookletActor = PermissionUser & { id: string };

/**
 * Cross-table unique claim for SI/DR/CR serials (Billing, Delivery, Collection,
 * Spoiled). Insert wins; unique violation means the serial is already used.
 * Claims are never deleted (voided docs keep the number used).
 */
export async function claimBookletSerial(tx: Tx, type: "SI" | "DR" | "CR", number: number) {
  try {
    await tx.bookletSerialClaim.create({ data: { type, number } });
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new DocRuleError(
        `${type} no. ${formatBookletNumber(number)} is already used / marked spoiled.`,
        type === "SI" ? "invoiceNo" : type === "DR" ? "drNumber" : "receiptNo",
      );
    }
    throw e;
  }
}

/** SI gap locks kept as a second line behind claimBookletSerial. */
export async function lockSiBookletNumber(tx: Tx, invoiceNo: number) {
  await tx.$queryRaw`SELECT \`id\` FROM \`SpoiledBookletNumber\` WHERE \`type\` = 'SI' AND \`number\` = ${invoiceNo} FOR UPDATE`;
  await tx.$queryRaw`SELECT \`id\` FROM \`Billing\` WHERE \`invoiceNo\` = ${invoiceNo} FOR UPDATE`;
}

export type SpoiledInput = {
  type: BookletType;
  number: number;
  reason: string;
};

export async function markBookletNumberSpoiled(
  input: SpoiledInput,
  actor: BookletActor,
  files: readonly UploadFile[] = [],
) {
  assertCan(actor, "record_billing");

  const trimmedReason = (input.reason ?? "").trim();
  if (!trimmedReason) {
    throw new DocRuleError("Reason is required.", "reason");
  }

  if (!Number.isInteger(input.number) || input.number < 1) {
    throw new DocRuleError("Enter a whole booklet number.", "number");
  }

  if (files.length === 0) {
    throw new DocRuleError("A photo of the spoiled booklet sheet is required.", "files");
  }

  const snap = await getSettingsSnapshot();
  const config =
    input.type === "DR"
      ? snap.settings.invoiceBooklet.deliveryReceipt
      : input.type === "CR"
        ? snap.settings.invoiceBooklet.collectionReceipt
        : snap.settings.invoiceBooklet.salesInvoice ?? snap.settings.invoiceBooklet;

  const rangeErr = bookletRangeError(input.number, config, input.type);
  if (rangeErr) throw new DocRuleError(rangeErr, "number");

  const uploads = await prepareUploads(files);

  try {
    return await withTxRetry(() =>
      db.$transaction(async (tx) => {
        if (input.type === "SI") {
          await lockSiBookletNumber(tx, input.number);
        } else {
          await tx.$queryRaw`SELECT \`id\` FROM \`SpoiledBookletNumber\` WHERE \`type\` = ${input.type} AND \`number\` = ${input.number} FOR UPDATE`;
        }

        // Check if already spoiled
        const existingSpoiled = await tx.spoiledBookletNumber.findFirst({
          where: { type: input.type, number: input.number },
          select: { id: true },
        });
        if (existingSpoiled) {
          throw new DocRuleError(
            `${input.type} no. ${formatBookletNumber(input.number)} is already used / marked spoiled.`,
            "number",
          );
        }

        // Check if used by an existing document
        if (input.type === "SI") {
          const taken = await tx.billing.findFirst({
            where: { invoiceNo: input.number },
            select: { id: true },
          });
          if (taken) {
            throw new DocRuleError(
              `SI no. ${formatBookletNumber(input.number)} is already used / marked spoiled.`,
              "number",
            );
          }
        } else if (input.type === "DR") {
          const deliveries = await tx.delivery.findMany({
            select: { drNumber: true },
          });
          const isTaken = deliveries.some((d) => parseBookletSerial(d.drNumber) === input.number);
          if (isTaken) {
            throw new DocRuleError(
              `DR no. ${formatBookletNumber(input.number)} is already used / marked spoiled.`,
              "number",
            );
          }
        } else if (input.type === "CR") {
          const collections = await tx.collection.findMany({
            where: { receiptNo: { not: null } },
            select: { receiptNo: true },
          });
          const isTaken = collections.some((c) => parseBookletSerial(c.receiptNo) === input.number);
          if (isTaken) {
            throw new DocRuleError(
              `CR no. ${formatBookletNumber(input.number)} is already used / marked spoiled.`,
              "number",
            );
          }
        }

        await claimBookletSerial(tx, input.type, input.number);

        const spoiled = await tx.spoiledBookletNumber.create({
          data: {
            type: input.type,
            number: input.number,
            reason: trimmedReason,
            createdById: actor.id,
          },
        });

        await createAttachments(tx, uploads, { spoiledBookletNumberId: spoiled.id }, actor.id);

        await writeAudit(tx, {
          userId: actor.id,
          entityType: "SpoiledBookletNumber",
          entityId: spoiled.id,
          action: "create",
          after: {
            type: input.type,
            number: input.number,
            reason: trimmedReason,
            attachments: uploads.length,
          },
        });

        return spoiled;
      }, DOC_TX),
    );
  } catch (e) {
    await discardUploads(uploads);
    if (isUniqueViolation(e)) {
      throw new DocRuleError(
        `${input.type} no. ${formatBookletNumber(input.number)} is already used / marked spoiled.`,
        "number",
      );
    }
    throw e;
  }
}
