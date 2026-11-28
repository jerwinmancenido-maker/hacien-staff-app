import { db, type Tx } from "@/lib/db";
import { DocRuleError } from "@/lib/documents/common";
import { ymd } from "@/lib/documents/common";

/**
 * S-56: "Remind me on any record" (v1: quotes, sales orders, supplier POs).
 * Reminders are personal — each staff member sees only their own — and are
 * never deleted; done ones stay listed under Done.
 */

export const REMINDER_TARGETS = ["QUOTE", "SALES_ORDER", "PURCHASE_ORDER"] as const;
export type ReminderTarget = (typeof REMINDER_TARGETS)[number];

export const REMINDER_TARGET_LABELS: Record<ReminderTarget, string> = {
  QUOTE: "Quote",
  SALES_ORDER: "Sales order",
  PURCHASE_ORDER: "Supplier PO",
};

export function reminderHref(entityType: string, entityId: string): string {
  if (entityType === "QUOTE") return `/quotes/${entityId}`;
  if (entityType === "SALES_ORDER") return `/sales-orders/${entityId}`;
  return `/purchase-orders/${entityId}`;
}

/** Pure validation for the Remind-me form (YYYY-MM-DD + short note). */
export function validateReminderInput(input: { entityType: string; remindAt: string; note: string }): {
  entityType: ReminderTarget;
  remindAt: Date;
  note: string;
} {
  if (!(REMINDER_TARGETS as readonly string[]).includes(input.entityType)) {
    throw new DocRuleError("Pick a record to remind yourself about.", "entityType");
  }
  const note = input.note.trim();
  if (!note) throw new DocRuleError("Write what the reminder is for.", "note");
  if (note.length > 500) throw new DocRuleError("Keep the note under 500 characters.", "note");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.remindAt)) {
    throw new DocRuleError("Pick a reminder date.", "remindAt");
  }
  const remindAt = new Date(`${input.remindAt}T00:00:00.000Z`);
  if (Number.isNaN(remindAt.getTime())) throw new DocRuleError("Pick a valid reminder date.", "remindAt");
  return { entityType: input.entityType as ReminderTarget, remindAt, note };
}

export async function createReminder(
  userId: string,
  input: { entityType: string; entityId: string; remindAt: string; note: string },
) {
  const valid = validateReminderInput(input);
  if (!input.entityId.trim()) throw new DocRuleError("Pick a record to remind yourself about.", "entityId");
  return db.reminder.create({
    data: {
      entityType: valid.entityType,
      entityId: input.entityId.trim(),
      note: valid.note,
      remindAt: valid.remindAt,
      createdById: userId,
    },
  });
}

export async function setReminderDone(id: string, userId: string, done: boolean) {
  const existing = await db.reminder.findUnique({ where: { id } });
  if (!existing || existing.createdById !== userId) throw new DocRuleError("Reminder not found.");
  // A hand toggle always clears the auto-close reason: done by hand carries
  // no reason, and undoing an auto-close reopens the reminder clean.
  return db.reminder.update({ where: { id }, data: { doneAt: done ? new Date() : null, doneReason: null } });
}

/**
 * Adoption item 13: auto-close every OPEN reminder on a record, inside the
 * caller's transaction, at the moment the record reaches a done state.
 * Event-based, never recomputed: a reminder closed here stays closed even
 * if the record later reopens, and one already closed by hand is untouched
 * (the doneAt: null filter), so its original doneAt is preserved. Closes
 * every owner's open reminders on the record — the same rule the document
 * delete flow has always used (markRemindersDone there) — while visibility
 * stays personal: each owner only ever sees their own list.
 */
export async function autoCloseReminders(
  tx: Tx,
  entityType: ReminderTarget,
  entityId: string,
  reason: string,
): Promise<number> {
  const res = await tx.reminder.updateMany({
    where: { entityType, entityId, doneAt: null },
    data: { doneAt: new Date(), doneReason: reason },
  });
  return res.count;
}

/** My open reminders whose date has passed (Home overdue count). */
export async function countMyOverdueReminders(userId: string, today: Date): Promise<number> {
  return db.reminder.count({
    where: { createdById: userId, doneAt: null, remindAt: { lt: today } },
  });
}

export type ReminderRow = {
  id: string;
  entityType: string;
  entityId: string;
  /** F33: the record's own number (QT-/SO-/PO-…), null when the record is gone. */
  entityNumber: string | null;
  note: string;
  remindAt: string;
  doneAt: string | null;
  /** Adoption item 13: the auto-close reason, when the record finished the reminder. */
  doneReason: string | null;
};

export async function listMyReminders(userId: string): Promise<ReminderRow[]> {
  const rows = await db.reminder.findMany({
    where: { createdById: userId },
    orderBy: [{ remindAt: "asc" }, { createdAt: "asc" }],
  });
  // F33: a row that says only "Supplier PO" doesn't say WHICH PO —
  // resolve each target's document number in one query per type.
  const idsOf = (t: string) => [...new Set(rows.filter((r) => r.entityType === t).map((r) => r.entityId))];
  const numbers = new Map<string, string>();
  const collect = (list: { id: string; number: string }[]) => list.forEach((x) => numbers.set(x.id, x.number));
  const [quotes, sos, pos] = await Promise.all([
    idsOf("QUOTE").length ? db.quote.findMany({ where: { id: { in: idsOf("QUOTE") } }, select: { id: true, number: true } }) : [],
    idsOf("SALES_ORDER").length ? db.salesOrder.findMany({ where: { id: { in: idsOf("SALES_ORDER") } }, select: { id: true, number: true } }) : [],
    idsOf("PURCHASE_ORDER").length ? db.purchaseOrder.findMany({ where: { id: { in: idsOf("PURCHASE_ORDER") } }, select: { id: true, number: true } }) : [],
  ]);
  collect(quotes);
  collect(sos);
  collect(pos);
  return rows.map((r) => ({
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    entityNumber: numbers.get(r.entityId) ?? null,
    note: r.note,
    remindAt: ymd(r.remindAt) ?? "",
    doneAt: r.doneAt ? r.doneAt.toISOString() : null,
    doneReason: r.doneReason ?? null,
  }));
}
