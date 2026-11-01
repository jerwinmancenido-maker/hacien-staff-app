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
import { billingToday } from "../billing/dates";
import { unappliedCash } from "../billing/status";
import { assertCashEnabled } from "../cash/features";
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

export type WithholdingCodeLine = { rate: string; atcCode: string | null; amount: string };

/**
 * Prefill ATC codes for a 2307.
 * - Prefer distinct ATCs from SO lines when every withholding line has an ATC
 *   (avoids splitting a goods-only total onto unused snapshot services codes).
 * - If any withholding line has a rate but null ATC (stacked picks), use the
 *   document withholding snapshot so stacked codes are not dropped.
 * - If lines yield nothing, fall back to the snapshot.
 */
export async function withholdingCodesFromSo(
  tx: Tx,
  salesOrderId: string,
): Promise<{ rate: string; atcCode: string | null }[]> {
  const so = await tx.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: {
      withholding: true,
      items: {
        where: { removedAt: null },
        select: { withholdingRate: true, withholdingAtc: true },
      },
    },
  });
  if (!so) return [];
  const snap = (so.withholding ?? []) as WithholdingSnapshot[];
  const fromSnap = snap
    .filter((s) => toScaled(s.rate, 4) > 0n)
    .map((s) => ({ rate: Number(s.rate).toFixed(4), atcCode: s.atcCode ?? null }));

  const fromLines = new Map<string, { rate: string; atcCode: string | null }>();
  let stackedNullAtc = false;
  for (const item of so.items) {
    const rate = item.withholdingRate != null ? Number(item.withholdingRate).toFixed(4) : "0.0000";
    if (toScaled(rate, 4) <= 0n) continue;
    const atc = item.withholdingAtc?.trim() || null;
    if (!atc) {
      stackedNullAtc = true;
      continue;
    }
    if (!fromLines.has(atc)) fromLines.set(atc, { rate, atcCode: atc });
  }
  if (fromLines.size > 0 && !stackedNullAtc) return [...fromLines.values()];
  if (fromSnap.length > 0) return fromSnap;
  return [...fromLines.values()];
}

/** Split a total across code rates; last line gets the remainder so cents match. */
export function splitWithholdingAcrossCodes(
  total: string,
  codes: readonly { rate: string; atcCode: string | null }[],
): WithholdingCodeLine[] {
  if (!codes.length) return [];
  const totalScaled = toScaled(money(total), 2);
  if (totalScaled <= 0n) return codes.map((c) => ({ ...c, amount: "0.00" }));
  const weights = codes.map((c) => toScaled(c.rate, 4));
  const weightSum = weights.reduce((a, w) => a + w, 0n);
  if (weightSum <= 0n) {
    // Equal split when rates missing.
    const n = BigInt(codes.length);
    const each = totalScaled / n;
    let used = 0n;
    return codes.map((c, i) => {
      const amt = i === codes.length - 1 ? totalScaled - used : each;
      used += amt;
      return { rate: c.rate, atcCode: c.atcCode, amount: fromScaled(amt, 2) };
    });
  }
  let used = 0n;
  return codes.map((c, i) => {
    const amt = i === codes.length - 1 ? totalScaled - used : (totalScaled * weights[i]!) / weightSum;
    used += amt;
    return { rate: c.rate, atcCode: c.atcCode, amount: fromScaled(amt, 2) };
  });
}

function resolveCodeLines(
  whAmount: string,
  codes: WithholdingCodeLine[] | undefined,
  fallbackRate: string,
  fallbackAtc: string | null,
): WithholdingCodeLine[] {
  if (codes?.length) return codes.filter((c) => toScaled(money(c.amount), 2) > 0n);
  if (toScaled(money(whAmount), 2) <= 0n) return [];
  return [{ rate: fallbackRate, atcCode: fallbackAtc, amount: money(whAmount) }];
}

/** Replace per-ATC lines without hard deletes (zero old rows; upsert by ATC). */
async function replace2307Lines(tx: Tx, withholding2307Id: string, lines: WithholdingCodeLine[]) {
  // Soft-clear existing amounts — records are never deleted.
  await tx.withholding2307Line.updateMany({ where: { withholding2307Id }, data: { amount: "0.00" } });
  for (const line of lines) {
    const existing = await tx.withholding2307Line.findFirst({
      where: { withholding2307Id, atcCode: line.atcCode ?? null },
    });
    if (existing) {
      await tx.withholding2307Line.update({
        where: { id: existing.id },
        data: { rate: line.rate, amount: money(line.amount) },
      });
    } else {
      await tx.withholding2307Line.create({
        data: {
          withholding2307Id,
          rate: line.rate,
          atcCode: line.atcCode,
          amount: money(line.amount),
        },
      });
    }
  }
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
    lines: WithholdingCodeLine[];
  },
) {
  const lineSum = args.lines.reduce((a, l) => a + toScaled(money(l.amount), 2), 0n);
  const amount = args.lines.length ? fromScaled(lineSum, 2) : money(args.amount);
  const first = args.lines[0];
  const rate = first?.rate ?? args.rate;
  const atcCode = first?.atcCode ?? args.atcCode;

  if (toScaled(amount, 2) <= 0n) {
    // Clear any prior pending row for this collection+billing if withholding was removed.
    const existing = await tx.withholding2307.findFirst({
      where: { billingId: args.billingId, collectionId: args.collectionId, status: "PENDING" },
    });
    if (existing) {
      await replace2307Lines(tx, existing.id, []);
      await tx.withholding2307.update({
        where: { id: existing.id },
        data: { amount: "0.00", notes: "Cleared — withholding no longer applied." },
      });
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
    const updated = await tx.withholding2307.update({
      where: { id: existing.id },
      data: { amount, rate, atcCode },
    });
    await replace2307Lines(tx, existing.id, args.lines);
    return updated;
  }
  const created = await tx.withholding2307.create({
    data: {
      billingId: args.billingId,
      collectionId: args.collectionId,
      customerId: args.customerId,
      rate,
      atcCode,
      amount,
      status: "PENDING",
    },
  });
  await replace2307Lines(tx, created.id, args.lines);
  return created;
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
          await assertCashEnabled();
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
              appliedOn: input.date,
            },
          });
          touched.add(a.billingId);
          if (toScaled(wh, 2) > 0n) {
            const billing = open.find((b) => b.id === a.billingId)!;
            const soCodes = await withholdingCodesFromSo(tx, billing.salesOrderId);
            const fallback = soCodes[0] ?? { rate: "0.0000", atcCode: null };
            const rate = a.withholdingRate || fallback.rate;
            const atc = a.atcCode !== undefined && a.atcCode !== null ? a.atcCode : fallback.atcCode;
            let lines = resolveCodeLines(wh, a.codes as WithholdingCodeLine[] | undefined, rate, atc);
            // Prefill multi-code from SO when the form sent only a total.
            if ((!a.codes || a.codes.length === 0) && soCodes.length > 1) {
              lines = splitWithholdingAcrossCodes(wh, soCodes);
            }
            // Line amounts must equal the validated withholding allocation (fail closed).
            if (lines.length) {
              const lineSum = lines.reduce((sum, l) => sum + toScaled(money(l.amount), 2), 0n);
              if (lineSum !== toScaled(wh, 2)) {
                throw new DocRuleError(
                  "2307 code amounts must add up to the withholding total for this billing.",
                  "allocations",
                );
              }
            }
            // Staff may record standard SO codes; custom rates need Admin.
            // Fail closed when the SO has no standard codes — any posted codes need Admin.
            if (!actor.isAdmin && lines.length) {
              if (!soCodes.length) {
                throw new DocRuleError(
                  "Only an Admin can set withholding rates when the sales order has none.",
                  "allocations",
                );
              }
              const standard = new Set(soCodes.map((c) => `${c.atcCode ?? ""}:${c.rate}`));
              for (const line of lines) {
                const key = `${line.atcCode ?? ""}:${line.rate}`;
                if (!standard.has(key)) {
                  throw new DocRuleError(
                    "Only an Admin can override withholding rates on a 2307. Use the rates from the sales order.",
                    "allocations",
                  );
                }
              }
            }
            await upsert2307(tx, {
              billingId: a.billingId,
              collectionId: collection.id,
              customerId: customer.id,
              amount: wh,
              rate,
              atcCode: atc,
              lines,
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
      const collectionIds = [...new Set(input.allocations.map((a) => a.collectionId))].sort();
      const billingIds = [...new Set(input.allocations.map((a) => a.billingId))];
      // Lock collections then their allocation rows (locking reads → latest committed)
      // so concurrent applies cannot overdraw the same credit under REPEATABLE READ.
      for (const id of collectionIds) {
        await tx.$queryRaw`SELECT \`id\` FROM \`Collection\` WHERE \`id\` = ${id} FOR UPDATE`;
        await tx.$queryRaw`SELECT \`id\` FROM \`CollectionAllocation\` WHERE \`collectionId\` = ${id} FOR UPDATE`;
      }
      await lockBillings(tx, billingIds);

      const collections = await tx.collection.findMany({
        where: { id: { in: collectionIds }, customerId: input.customerId, status: "POSTED" },
      });
      if (collections.length !== collectionIds.length) throw new DocRuleError("One of the collections isn't posted for this customer.");

      const creditLeft = new Map<string, bigint>();
      for (const c of collections) {
        // Locking read of cash applied (same snapshot as the FOR UPDATE above).
        const appliedRows = await tx.$queryRaw<{ cashApplied: { toFixed(n: number): string } | string | number }[]>`
          SELECT \`cashApplied\` FROM \`CollectionAllocation\` WHERE \`collectionId\` = ${c.id} FOR UPDATE`;
        const applied = appliedRows.reduce((a, x) => a + toScaled(money(x.cashApplied), 2), 0n);
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
        // Credit is unapplied *cash* only. Withholding-only (or any new 2307) on
        // a credit apply would shrink AR without consuming credit.
        if (wh > 0n) {
          throw new DocRuleError(
            "Withholding can't be applied from customer credit. Record 2307 when you collect the payment, then apply cash credit only.",
            "allocations",
          );
        }
        if (cash === 0n) continue;
        const left = creditLeft.get(a.collectionId) ?? 0n;
        if (cash > left) {
          throw new DocRuleError(
            `Cash applied exceeds the unapplied credit on a collection (₱${fromScaled(left, 2)} left). Reduce the amount or pick another collection with credit.`,
            "allocations",
          );
        }
        const billing = sim.get(a.billingId);
        if (!billing) {
          throw new DocRuleError(
            "One of the billings isn't open for this customer. Refresh the page and pick an open billing.",
            "allocations",
          );
        }
        const rem =
          toScaled(billing.amount, 2) - toScaled(billing.alreadyCash, 2) - toScaled(billing.alreadyWithholding, 2);
        // Applied amount is cash-only; credit consumed must equal applied amount.
        if (cash > rem) {
          throw new DocRuleError(
            `Allocation exceeds the remaining balance on a billing (₱${fromScaled(rem, 2)} left). Lower the amount to at most the open balance.`,
            "allocations",
          );
        }

        // Always insert a new dated row (never merge) so statement "as of"
        // opening credit can ignore applications on/after the period start.
        await tx.collectionAllocation.create({
          data: {
            collectionId: a.collectionId,
            billingId: a.billingId,
            cashApplied: fromScaled(cash, 2),
            withholdingApplied: "0.00",
            appliedOn: billingToday(),
          },
        });
        creditLeft.set(a.collectionId, left - cash);
        billing.alreadyCash = fromScaled(toScaled(billing.alreadyCash, 2) + cash, 2);
        touched.add(a.billingId);
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
          await replace2307Lines(tx, w.id, []);
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
