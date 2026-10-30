// Cash transfers (TRF-YYYY-####): move money between accounts (e.g. bank deposit of cash).

import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { writeAudit } from "../audit";
import { assertCan, type PermissionUser } from "../permissions";
import { getSettingsSnapshot } from "../settings";
import { allocateDocNumber, ensureSeries } from "../documents/series";
import { DocRuleError, DOC_TX, money, withTxRetry, ymd } from "../documents/common";
import { toScaled } from "../quotes/calc";
import type { CashTransferInput } from "../validation/cash";

export type TransferActor = PermissionUser & { id: string };

function assertManageCash(actor: TransferActor) {
  assertCan(actor, "manage_cash");
}

export async function listCashTransfers(filters: { status?: "POSTED" | "VOID" | "ALL" } = {}) {
  return db.cashTransfer.findMany({
    where: filters.status && filters.status !== "ALL" ? { status: filters.status } : undefined,
    include: {
      fromAccount: { select: { id: true, name: true } },
      toAccount: { select: { id: true, name: true } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
}

export async function getCashTransfer(id: string) {
  return db.cashTransfer.findUnique({
    where: { id },
    include: {
      fromAccount: true,
      toAccount: true,
      createdBy: { select: { id: true, name: true } },
    },
  });
}

export async function recordCashTransfer(input: CashTransferInput, actor: TransferActor) {
  assertManageCash(actor);
  if (toScaled(input.amount, 2) <= 0n) throw new DocRuleError("Amount must be greater than 0.", "amount");
  if (input.fromAccountId === input.toAccountId) {
    throw new DocRuleError("Pick two different accounts.", "toAccountId");
  }

  const snap = await getSettingsSnapshot();
  const format = snap.settings.numbering.cashTransfer;
  const year = input.date.getUTCFullYear();
  await ensureSeries(db, "CASH_TRANSFER", year, format);

  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      const from = await tx.cashAccount.findUnique({ where: { id: input.fromAccountId } });
      const to = await tx.cashAccount.findUnique({ where: { id: input.toAccountId } });
      if (!from || !from.active) {
        throw new DocRuleError("Pick an active 'from' account.", "fromAccountId");
      }
      if (!to || !to.active) {
        throw new DocRuleError("Pick an active 'to' account.", "toAccountId");
      }

      const number = await allocateDocNumber(tx, "CASH_TRANSFER", year, format);
      const transfer = await tx.cashTransfer.create({
        data: {
          number,
          date: input.date,
          fromAccountId: from.id,
          toAccountId: to.id,
          amount: input.amount,
          notes: input.notes,
          createdById: actor.id,
        },
      });
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "CashTransfer",
        entityId: transfer.id,
        action: "create",
        after: {
          number,
          date: ymd(input.date),
          from: from.name,
          to: to.name,
          amount: input.amount,
        },
      });
      return transfer;
    }, DOC_TX),
  );
}

export async function voidCashTransfer(id: string, reason: string, actor: TransferActor) {
  assertManageCash(actor);
  const why = reason.trim();
  if (!why) throw new DocRuleError("A reason is required.", "reason");

  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT \`id\` FROM \`CashTransfer\` WHERE \`id\` = ${id} FOR UPDATE`;
      const before = await tx.cashTransfer.findUnique({ where: { id } });
      if (!before) throw new DocRuleError("Transfer not found.");
      if (before.status === "VOID") throw new DocRuleError("This transfer is already void.");

      const now = new Date();
      const after = await tx.cashTransfer.update({
        where: { id },
        data: { status: "VOID", voidedAt: now, voidReason: why },
      });
      await tx.documentVoid.create({
        data: {
          docType: "CASH_TRANSFER",
          docNumber: before.number,
          docId: id,
          reason: why,
          snapshot: JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue,
          voidedById: actor.id,
          voidedAt: now,
        },
      });
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "CashTransfer",
        entityId: id,
        action: "void",
        before: { status: "POSTED", amount: money(before.amount) },
        after: { status: "VOID", voidReason: why },
        diff: false,
      });
      return after;
    }, DOC_TX),
  );
}
