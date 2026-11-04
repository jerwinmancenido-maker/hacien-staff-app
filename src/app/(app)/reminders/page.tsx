import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { listMyReminders, reminderHref, REMINDER_TARGET_LABELS } from "@/lib/services/reminders";
import { manilaToday, formatDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { setReminderDoneAction } from "./actions";

/** S-56: my reminders — overdue first, then upcoming, then done. */
export default async function RemindersPage() {
  const user = await requirePagePermission("view");
  const reminders = await listMyReminders(user.id);
  const today = manilaToday();
  const todayStr = today.toISOString().slice(0, 10);
  const open = reminders.filter((r) => !r.doneAt);
  const overdue = open.filter((r) => r.remindAt < todayStr);
  const upcoming = open.filter((r) => r.remindAt >= todayStr);
  const done = reminders.filter((r) => r.doneAt);

  const row = (r: (typeof reminders)[number], isDone: boolean) => (
    <tr key={r.id}>
      <td>
        <Link href={reminderHref(r.entityType, r.entityId)}>
          {REMINDER_TARGET_LABELS[r.entityType as keyof typeof REMINDER_TARGET_LABELS] ?? r.entityType}
        </Link>
        <div className="small faint">{r.note}</div>
      </td>
      <td className="num">{formatDate(new Date(`${r.remindAt}T00:00:00.000Z`))}</td>
      <td>
        <form action={setReminderDoneAction.bind(null, r.id, !isDone)}>
          <button className="btn-link small" type="submit">
            {isDone ? "Undo" : "Done"}
          </button>
        </form>
      </td>
    </tr>
  );

  const table = (rows: typeof reminders, label: string, empty: string) => (
    <>
      <h2>{label}</h2>
      {rows.length === 0 ? (
        <p className="faint">{empty}</p>
      ) : (
        <div className="table-wrap">
          <table className="list" aria-label={label}>
            <thead>
              <tr>
                <th>Reminder</th>
                <th className="num">Remind on</th>
                <th />
              </tr>
            </thead>
            <tbody>{rows.map((r) => row(r, !!r.doneAt))}</tbody>
          </table>
        </div>
      )}
    </>
  );

  return (
    <>
      <PageHeader title="Reminders" subtitle="Your own reminders on quotes, sales orders and supplier POs. Set one from any of those records." />
      {table(overdue, "Overdue", "Nothing overdue.")}
      {table(upcoming, "Upcoming", "No upcoming reminders — set one from a quote, sales order or PO.")}
      {table(done, "Done", "Nothing done yet.")}
    </>
  );
}
