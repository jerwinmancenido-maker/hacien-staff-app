// Phase 4 #10: period close — the ONE guard every inventoried posting
// path calls, plus the Admin-only close/reopen service.
//
// Rules (period-close-plan.md, decisions recorded there):
//  - assertPeriodOpen(tx, date) does ONE indexed lookup inside the
//    caller's transaction, AFTER the path's own root lock. No lock row
//    (or closed = false) means open. The guard NEVER reads the feature
//    flag: locks can only be created while the flag is on, so flag-off
//    with no locks is a no-op — and turning the flag off later must
//    never silently reopen closed books.
//  - Close/reopen are active-Admin only, audited in the same tx, with
//    no silent no-ops. Reopen requires a typed reason (kept on the row
//    AND in the audit record). Future months cannot be closed.
//  - Void rule (recorded Muse decision): closed-period voids are
//    REFUSED — that falls out of guarding every void path by its
//    record's own date; there is no special case here.

import { db, type Tx } from "../db";
import { writeAudit } from "../audit";
import { getSettingsSnapshot } from "../settings";
import { ForbiddenError, type PermissionUser } from "../permissions";
import { DocRuleError, withTxRetry } from "../documents/common";
import {
  closedPeriodMessage,
  isValidYearMonth,
  monthLabel,
  periodCloseEnabledFromEnv,
  yearMonthOf,
} from "../period-close-shared";

export { closedPeriodMessage, isValidYearMonth, monthLabel, yearMonthOf };
export { periodCloseEnabledFromEnv } from "../period-close-shared";

export type PeriodCloseActor = PermissionUser & { id: string };

function assertActiveAdmin(actor: PeriodCloseActor | null | undefined): asserts actor is PeriodCloseActor {
  if (!actor || !actor.active || !actor.isAdmin) throw new ForbiddenError();
}

function assertValidYearMonth(yearMonth: string): void {
  if (!isValidYearMonth(yearMonth)) {
    throw new DocRuleError("Pick a valid month (YYYY-MM).");
  }
}

/** Closing a FUTURE month is refused; the current month may be closed. */
function assertNotFutureMonth(yearMonth: string): void {
  if (yearMonth > yearMonthOf(new Date())) {
    throw new DocRuleError(`${monthLabel(yearMonth)} has not happened yet — it cannot be closed.`);
  }
}

/** Effective flag: env override if set, else Settings.features.periodCloseEnabled (default false). */
export async function isPeriodCloseEnabled(): Promise<boolean> {
  const fromEnv = periodCloseEnabledFromEnv();
  if (fromEnv !== null) return fromEnv;
  const snap = await getSettingsSnapshot();
  return snap.settings.features.periodCloseEnabled === true;
}

/**
 * The guard. Call inside the posting path's own transaction, after its
 * root lock, before any write. Throws DocRuleError naming the month
 * when that month is closed.
 */
export async function assertPeriodOpen(tx: Tx, date: Date): Promise<void> {
  const yearMonth = yearMonthOf(date);
  const row = await tx.periodLock.findUnique({ where: { yearMonth } });
  if (row?.closed) throw new DocRuleError(closedPeriodMessage(yearMonth));
}

async function lockPeriodRow(tx: Tx, yearMonth: string): Promise<void> {
  await tx.$queryRaw`SELECT \`id\` FROM \`PeriodLock\` WHERE \`yearMonth\` = ${yearMonth} FOR UPDATE`;
}

export async function closePeriod(yearMonth: string, actor: PeriodCloseActor) {
  assertActiveAdmin(actor);
  assertValidYearMonth(yearMonth);
  assertNotFutureMonth(yearMonth);
  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      await tx.periodLock.upsert({
        where: { yearMonth },
        create: { yearMonth },
        update: {},
      });
      // K6: hold the month's row lock while flipping state, so a racing
      // post either committed before this close or sees closed after it.
      await lockPeriodRow(tx, yearMonth);
      const row = await tx.periodLock.findUnique({ where: { yearMonth } });
      if (row?.closed) throw new DocRuleError(`${monthLabel(yearMonth)} is already closed.`);
      const now = new Date();
      const updated = await tx.periodLock.update({
        where: { yearMonth },
        data: { closed: true, closedById: actor.id, closedAt: now },
      });
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "PeriodLock",
        entityId: yearMonth,
        action: "create",
        after: { yearMonth, closed: true },
      });
      return updated;
    }),
  );
}

export async function reopenPeriod(yearMonth: string, reason: string, actor: PeriodCloseActor) {
  assertActiveAdmin(actor);
  assertValidYearMonth(yearMonth);
  const trimmed = (reason ?? "").trim();
  if (!trimmed) throw new DocRuleError("Type a reason for reopening the month.");
  if (trimmed.length > 500) throw new DocRuleError("The reopen reason is too long (at most 500 characters).");
  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      await lockPeriodRow(tx, yearMonth);
      const row = await tx.periodLock.findUnique({ where: { yearMonth } });
      if (!row?.closed) throw new DocRuleError(`${monthLabel(yearMonth)} is not closed.`);
      const now = new Date();
      const updated = await tx.periodLock.update({
        where: { yearMonth },
        data: { closed: false, reopenedById: actor.id, reopenedAt: now, reopenReason: trimmed },
      });
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "PeriodLock",
        entityId: yearMonth,
        action: "update",
        after: { yearMonth, closed: false, reopenReason: trimmed },
      });
      return updated;
    }),
  );
}

/** All known period rows, newest month first (Books card). */
export async function listPeriodLocks() {
  return db.periodLock.findMany({ orderBy: { yearMonth: "desc" } });
}
