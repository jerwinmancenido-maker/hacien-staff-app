import { db } from "@/lib/db";
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
  return db.reminder.update({ where: { id }, data: { doneAt: done ? new Date() : null } });
}

export type ReminderRow = {
  id: string;
  entityType: string;
  entityId: string;
  note: string;
  remindAt: string;
  doneAt: string | null;
};

export async function listMyReminders(userId: string): Promise<ReminderRow[]> {
  const rows = await db.reminder.findMany({
    where: { createdById: userId },
    orderBy: [{ remindAt: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    note: r.note,
    remindAt: ymd(r.remindAt) ?? "",
    doneAt: r.doneAt ? r.doneAt.toISOString() : null,
  }));
}
