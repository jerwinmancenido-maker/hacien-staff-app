// Collections (CR-YYYY-####): record customer payments / advances. Cash may be
// left unapplied as customer credit and applied to later billings. When
// withholding is applied, a PENDING Withholding2307 row is created/updated.

import type { Prisma } from "@prisma/client";
import { db, type Tx } from "../db";
import { writeAudit } from "../audit";
import { assertCan, type PermissionUser } from "../permissions";
import { getSettingsSnapshot } from "../settings";
import { allocateDocNumber, ensureSeries } from "../documents/series";
import { DocRuleError, DOC_TX, money, withTxRetry, ymd } from "../documents/common";
import { fromScaled, toScaled, type WithholdingSnapshot } from "../quotes/calc";
import { validateAllocations, type AllocationInput, type BillingForAlloc } from "../billing/allocations";
import { unappliedCash } from "../billing/status";
import type { ApplyCreditInput, CollectionInput, Mark2307ReceivedInput } from "../validation/billing";
import { createAttachments, discardUploads, prepareUploads, type UploadFile } from "./attachments";
import { recomputeBillingStatus } from "./billings";

export type CollectionActor = PermissionUser & { id: string };

function assertManageBilling(actor: CollectionActor) {
  assertCan(actor, "manage_billing");
}

async function lockCustomer(tx: Tx, customerId: string) {
  const rows = await tx.$queryRaw<{ id: string; name: string }[]>`SELECT \`id\`, \`name\` FROM \`Customer\` WHERE \`id\` = ${customerId} FOR UPDATE`;
  if (!rows[0]) throw new DocRuleError("Customer not found.");
  return rows[0];
}

async function lockBillings(tx: Tx, ids: string[]) {
  if (!ids.length) return;
  // Lock in id order to avoid deadlocks between concurrent collections.
  const sorted = [...ids].sort();
  for (const id of sorted) {
    await tx.$queryRaw`SELECT \`id\` FROM \`Billing\` WHERE \`id\` = ${id} FOR UPDATE`;
  }
}

async function billingsForAlloc(tx: Tx, customerId: string, excludeCollectionId?: string): Promise<(BillingForAlloc & { dueDate: Date; salesOrderId: string })[]> {
  const rows = await tx.billing.findMany({
    where: { customerId, status: { not: "VOID" } },
    include: {
      allocations: {
        where: {
          collection: { status: "POSTED", ...(excludeCollectionId ? { id: { not: excludeCollectionId } } : {}) },
        },
      },
    },
    orderBy: [{ dueDate: "asc" }, { invoiceDate: "asc" }],
  });
  return rows.map((b) => ({
    id: b.id,
    amount: money(b.amount),
    dueDate: b.dueDate,
    salesOrderId: b.salesOrderId,
    alreadyCash: fromScaled(
      b.allocations.reduce((a, x) => a + toScaled(money(x.cashApplied), 2), 0n),
      2,
    ),
    alreadyWithholding: fromScaled(
      b.allocations.reduce((a, x) => a + toScaled(money(x.withholdingApplied), 2), 0n),
      2,
    ),
  }));
}

/** Default 2307 rate + ATC from the SO withholding snapshot (first rate), editable per payment. */
async function withholdingDefaults(tx: Tx, salesOrderId: string): Promise<{ rate: string; atcCode: string | null }> {
  const so = await tx.salesOrder.findUnique({ where: { id: salesOrderId }, select: { withholding: true } });
  const snap = (so?.withholding ?? []) as WithholdingSnapshot[];
  if (!snap.length) return { rate: "0.0000", atcCode: null };
  const first = snap[0]!;
  return { rate: first.rate, atcCode: first.atcCode };
}

async function upsert2307(
  tx: Tx,
  args: {
    billingId: string;
    collectionId: string;
    customerId: string;
    amount: string;
    rate: string;
    atcCode: string | null;
  },
) {
  if (toScaled(args.amount, 2) <= 0n) {
    // Clear any prior pending row for this collection+billing if withholding was removed.
    const existing = await tx.withholding2307.findFirst({
      where: { billingId: args.billingId, collectionId: args.collectionId, status: "PENDING" },
    });
    if (existing) {
      await tx.withholding2307.update({ where: { id: existing.id }, data: { amount: "0.00", notes: "Cleared — withholding no longer applied." } });
    }
    return null;
  }
  const existing = await tx.withholding2307.findFirst({
    where: { billingId: args.billingId, collectionId: args.collectionId },
  });
  if (existing) {
    if (existing.status === "RECEIVED") {
      // Keep received rows; create a new pending delta only if amount grew — for simplicity update notes.
      return existing;
    }
    return tx.withholding2307.update({
      where: { id: existing.id },
      data: { amount: args.amount, rate: args.rate, atcCode: args.atcCode },
    });
  }
  return tx.withholding2307.create({
    data: {
      billingId: args.billingId,
      collectionId: args.collectionId,
      customerId: args.customerId,
      rate: args.rate,
      atcCode: args.atcCode,
      amount: args.amount,
      status: "PENDING",
    },
  });
}

export async function recordCollection(input: CollectionInput, actor: CollectionActor, files: readonly UploadFile[] = []) {
  assertManageBilling(actor);
  if (toScaled(input.amountReceived, 2) <= 0n) throw new DocRuleError("Amount received must be greater than 0.", "amountReceived");

  const snap = await getSettingsSnapshot();
  const format = snap.settings.numbering.collection;
  const year = input.date.getUTCFullYear();
  await ensureSeries(db, "COLLECTION", year, format);
  const uploads = await prepareUploads(files);

  try {
    return await withTxRetry(() =>
      db.$transaction(async (tx) => {
        const customer = await lockCustomer(tx, input.customerId);
        const allocInputs: AllocationInput[] = input.allocations.map((a) => ({
          billingId: a.billingId,
          cashApplied: a.cashApplied,
          withholdingApplied: a.withholdingApplied,
        }));
        await lockBillings(
          tx,
          allocInputs.map((a) => a.billingId),
        );
        const open = await billingsForAlloc(tx, customer.id);
        const issue = validateAllocations(input.amountReceived, allocInputs, open);
        if (issue) throw new DocRuleError(issue.message, issue.field);

        const number = await allocateDocNumber(tx, "COLLECTION", year, format);
        if (input.cashAccountId) {
          const acct = await tx.cashAccount.findUnique({ where: { id: input.cashAccountId } });
          if (!acct || !acct.active) {
            throw new DocRuleError("Pick an active cash account, or leave it blank (Not assigned).", "cashAccountId");
          }
        }

        const collection = await tx.collection.create({
          data: {
            number,
            customerId: customer.id,
            date: input.date,
            method: input.method,
            reference: input.reference,
            checkBank: input.checkBank,
            checkDate: input.checkDate,
            receiptNo: input.receiptNo,
            amountReceived: input.amountReceived,
            cashAccountId: input.cashAccountId ?? null,
            notes: input.notes,
            createdById: actor.id,
          },
        });

        const touched = new Set<string>();
        for (const a of input.allocations) {
          const cash = money(a.cashApplied);
          const wh = money(a.withholdingApplied);
          if (toScaled(cash, 2) === 0n && toScaled(wh, 2) === 0n) continue;
          await tx.collectionAllocation.create({
            data: {
              collectionId: collection.id,
              billingId: a.billingId,
              cashApplied: cash,
              withholdingApplied: wh,
            },
          });
          touched.add(a.billingId);
          if (toScaled(wh, 2) > 0n) {
            const billing = open.find((b) => b.id === a.billingId)!;
            const defaults = await withholdingDefaults(tx, billing.salesOrderId);
            const rate = a.withholdingRate || defaults.rate;
            const atc = a.atcCode !== undefined && a.atcCode !== null ? a.atcCode : defaults.atcCode;
            await upsert2307(tx, {
              billingId: a.billingId,
              collectionId: collection.id,
              customerId: customer.id,
              amount: wh,
              rate,
              atcCode: atc,
            });
          }
        }
        for (const billingId of touched) await recomputeBillingStatus(tx, billingId, actor.id);

        await createAttachments(tx, uploads, { collectionId: collection.id }, actor.id);

        const cashApplied = allocInputs.reduce((acc, a) => acc + toScaled(a.cashApplied || "0", 2), 0n);
        const credit = fromScaled(toScaled(input.amountReceived, 2) - cashApplied, 2);
        await writeAudit(tx, {
          userId: actor.id,
          entityType: "Collection",
          entityId: collection.id,
          action: "create",
          after: {
            number,
            customer: customer.name,
            date: ymd(input.date),
            method: input.method,
            receiptNo: input.receiptNo,
            amountReceived: input.amountReceived,
            cashAccountId: input.cashAccountId ?? null,
            cashApplied: fromScaled(cashApplied, 2),
            unappliedCredit: credit,
            allocations: allocInputs.length,
            attachments: uploads.length,
          },
        });
        return collection;
      }, DOC_TX),
    );
  } catch (e) {
    await discardUploads(uploads);
    throw e;
  }
}

/**
 * Apply unapplied credit from posted collections onto open billings.
 * Never lets applied cash exceed each collection's remaining credit.
 */
export async function applyCustomerCredit(input: ApplyCreditInput, actor: CollectionActor) {
  assertManageBilling(actor);
  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      await lockCustomer(tx, input.customerId);
      const collectionIds = [...new Set(input.allocations.map((a) => a.collectionId))];
      const billingIds = [...new Set(input.allocations.map((a) => a.billingId))];
      for (const id of [...collectionIds].sort()) {
        await tx.$queryRaw`SELECT \`id\` FROM \`Collection\` WHERE \`id\` = ${id} FOR UPDATE`;
      }
      await lockBillings(tx, billingIds);

      const collections = await tx.collection.findMany({
        where: { id: { in: collectionIds }, customerId: input.customerId, status: "POSTED" },
        include: { allocations: true },
      });
      if (collections.length !== collectionIds.length) throw new DocRuleError("One of the collections isn't posted for this customer.");

      const creditLeft = new Map<string, bigint>();
      for (const c of collections) {
        const applied = c.allocations.reduce((a, x) => a + toScaled(money(x.cashApplied), 2), 0n);
        creditLeft.set(c.id, toScaled(money(c.amountReceived), 2) - applied);
      }

      const open = await billingsForAlloc(tx, input.customerId);
      // Simulate incremental application for validation.
      const sim = new Map(open.map((b) => [b.id, { ...b }]));
      const touched = new Set<string>();

      for (const a of input.allocations) {
        const cash = toScaled(a.cashApplied, 2);
        const wh = toScaled(a.withholdingApplied || "0", 2);
        if (cash < 0n || wh < 0n) throw new DocRuleError("Applied amounts can't be negative.", "allocations");
        if (cash === 0n && wh === 0n) continue;
        const left = creditLeft.get(a.collectionId) ?? 0n;
        if (cash > left) {
          throw new DocRuleError(
            `Cash applied exceeds the unapplied credit on a collection (₱${fromScaled(left, 2)} left).`,
            "allocations",
          );
        }
        const billing = sim.get(a.billingId);
        if (!billing) throw new DocRuleError("One of the billings isn't open for this customer.", "allocations");
        const rem =
          toScaled(billing.amount, 2) - toScaled(billing.alreadyCash, 2) - toScaled(billing.alreadyWithholding, 2);
        if (cash + wh > rem) {
          throw new DocRuleError(`Allocation exceeds the remaining balance on a billing (₱${fromScaled(rem, 2)} left).`, "allocations");
        }

        const existing = await tx.collectionAllocation.findUnique({
          where: { collectionId_billingId: { collectionId: a.collectionId, billingId: a.billingId } },
        });
        if (existing) {
          await tx.collectionAllocation.update({
            where: { id: existing.id },
            data: {
              cashApplied: fromScaled(toScaled(money(existing.cashApplied), 2) + cash, 2),
              withholdingApplied: fromScaled(toScaled(money(existing.withholdingApplied), 2) + wh, 2),
            },
          });
        } else {
          await tx.collectionAllocation.create({
            data: {
              collectionId: a.collectionId,
              billingId: a.billingId,
              cashApplied: fromScaled(cash, 2),
              withholdingApplied: fromScaled(wh, 2),
            },
          });
        }
        creditLeft.set(a.collectionId, left - cash);
        billing.alreadyCash = fromScaled(toScaled(billing.alreadyCash, 2) + cash, 2);
        billing.alreadyWithholding = fromScaled(toScaled(billing.alreadyWithholding, 2) + wh, 2);
        touched.add(a.billingId);

        if (wh > 0n) {
          const defaults = await withholdingDefaults(tx, billing.salesOrderId);
          await upsert2307(tx, {
            billingId: a.billingId,
            collectionId: a.collectionId,
            customerId: input.customerId,
            amount: fromScaled(wh, 2),
            rate: a.withholdingRate || defaults.rate,
            atcCode: a.atcCode !== undefined && a.atcCode !== null ? a.atcCode : defaults.atcCode,
          });
        }
      }

      for (const billingId of touched) await recomputeBillingStatus(tx, billingId, actor.id);
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "Customer",
        entityId: input.customerId,
        action: "update",
        before: null,
        after: { creditApplied: input.allocations.length, billings: [...touched] },
        diff: false,
      });
      return { applied: input.allocations.length, billings: [...touched] };
    }, DOC_TX),
  );
}

export async function voidCollection(id: string, reason: string, actor: CollectionActor) {
  assertManageBilling(actor);
  const why = reason.trim();
  if (!why) throw new DocRuleError("A reason is required.", "reason");

  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT \`id\` FROM \`Collection\` WHERE \`id\` = ${id} FOR UPDATE`;
      const before = await tx.collection.findUnique({
        where: { id },
        include: { allocations: true, withholdings: true },
      });
      if (!before) throw new DocRuleError("Collection not found.");
      if (before.status === "VOID") throw new DocRuleError("This collection is already void.");

      await lockBillings(
        tx,
        before.allocations.map((a) => a.billingId),
      );

      // Received 2307s block void — staff must keep the tax certificate trail.
      const received = before.withholdings.filter((w) => w.status === "RECEIVED");
      if (received.length) {
        throw new DocRuleError("This collection has a received 2307. It can't be voided.");
      }

      const now = new Date();
      const after = await tx.collection.update({
        where: { id },
        data: { status: "VOID", voidedAt: now, voidReason: why },
      });
      // Soft-clear pending 2307 amounts (keep rows for audit; same as upsert2307
      // when withholding is removed — amount 0.00, status stays PENDING).
      for (const w of before.withholdings) {
        if (w.status === "PENDING") {
          await tx.withholding2307.update({
            where: { id: w.id },
            data: {
              amount: "0.00",
              notes: `Voided with collection ${before.number}: ${why}`,
            },
          });
        }
      }
      for (const a of before.allocations) await recomputeBillingStatus(tx, a.billingId, actor.id);

      await tx.documentVoid.create({
        data: {
          docType: "COLLECTION",
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
        entityType: "Collection",
        entityId: id,
        action: "void",
        before: { status: "POSTED", amountReceived: money(before.amountReceived) },
        after: { status: "VOID", voidReason: why },
        diff: false,
      });
      return after;
    }, DOC_TX),
  );
}

export async function mark2307Received(
  id: string,
  input: Mark2307ReceivedInput,
  actor: CollectionActor,
  files: readonly UploadFile[] = [],
) {
  assertManageBilling(actor);
  const uploads = await prepareUploads(files);
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT \`id\` FROM \`Withholding2307\` WHERE \`id\` = ${id} FOR UPDATE`;
      const row = await tx.withholding2307.findUnique({ where: { id } });
      if (!row) throw new DocRuleError("2307 record not found.");
      if (row.status === "RECEIVED") throw new DocRuleError("This 2307 is already marked received.");
      if (toScaled(money(row.amount), 2) <= 0n) throw new DocRuleError("Nothing to receive on a zero-amount 2307.");

      const after = await tx.withholding2307.update({
        where: { id },
        data: { status: "RECEIVED", receivedAt: input.receivedAt, notes: input.notes ?? row.notes },
      });
      await createAttachments(tx, uploads, { withholding2307Id: id }, actor.id);
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "Withholding2307",
        entityId: id,
        action: "update",
        before: { status: "PENDING" },
        after: { status: "RECEIVED", receivedAt: ymd(input.receivedAt), attachments: uploads.length },
        diff: false,
      });
      return after;
    });
  } catch (e) {
    await discardUploads(uploads);
    throw e;
  }
}

/** Customer credit = sum of unapplied cash on posted collections. */
export async function customerCreditBalance(customerId: string): Promise<string> {
  const collections = await db.collection.findMany({
    where: { customerId, status: "POSTED" },
    include: { allocations: true },
  });
  let credit = 0n;
  for (const c of collections) {
    const u = unappliedCash(
      money(c.amountReceived),
      c.allocations.map((a) => money(a.cashApplied)),
    );
    credit += toScaled(u, 2);
  }
  return fromScaled(credit, 2);
}
