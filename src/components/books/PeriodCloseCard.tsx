"use client";

// Phase 4 #10: Books → Period close card (plan P7). Rendered only when
// the periodCloseEnabled flag is on. Everyone with Books access sees
// the closed-months list read-only; Admins additionally get the close
// form (month picker, default last month) and a Reopen control with a
// required typed reason per closed month. The server actions and the
// service re-check Admin + flag — nothing here is trusted.

import { useFormAction } from "@/components/useFormAction";
import { closePeriodAction, reopenPeriodAction } from "@/app/(app)/books/actions";
import { formatDate } from "@/lib/format";
import { monthLabel } from "@/lib/period-close-shared";

export type PeriodLockRow = {
  yearMonth: string;
  closed: boolean;
  closedAt: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
};

function CloseMonthForm({ defaultMonth }: { defaultMonth: string }) {
  const { state, pending, onSubmit } = useFormAction(closePeriodAction);
  return (
    <form onSubmit={onSubmit} style={{ marginTop: 12 }}>
      <div className="small strong">Close a month</div>
      <p className="faint small" style={{ margin: "4px 0 8px" }}>
        Once closed, no record dated in that month can be created, changed, voided, or deleted
        until an Admin reopens it. Existing records stay readable.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="month"
          name="yearMonth"
          aria-label="Month to close"
          defaultValue={state.values?.yearMonth ?? defaultMonth}
          required
        />
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Closing…" : "Close month"}
        </button>
      </div>
      {state.message ? (
        <div className={state.ok ? "alert ok" : "alert error"} role="status" style={{ marginTop: 8 }}>
          {state.message}
        </div>
      ) : null}
    </form>
  );
}

function ReopenMonthForm({ yearMonth }: { yearMonth: string }) {
  const { state, pending, onSubmit } = useFormAction(reopenPeriodAction);
  return (
    <form onSubmit={onSubmit} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
      <input type="hidden" name="yearMonth" value={yearMonth} />
      <input
        name="reason"
        aria-label={`Reason for reopening ${monthLabel(yearMonth)}`}
        placeholder="Reason for reopening (required)"
        required
        maxLength={500}
        style={{ minWidth: 220 }}
      />
      <button className="btn btn-secondary" type="submit" disabled={pending}>
        {pending ? "Reopening…" : "Reopen"}
      </button>
      {state.message ? (
        <span className="small" role="status">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

export function PeriodCloseCard({
  locks,
  isAdmin,
  defaultMonth,
}: {
  locks: PeriodLockRow[];
  isAdmin: boolean;
  defaultMonth: string;
}) {
  const closed = locks.filter((l) => l.closed);
  const reopened = locks.filter((l) => !l.closed);
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="strong">Period close</div>
      {closed.length === 0 ? (
        <p className="faint small" style={{ margin: "4px 0 0" }}>
          No months are closed. Records can be posted into any month.
        </p>
      ) : (
        <ul className="plain-list" style={{ paddingLeft: 18, margin: "8px 0 0" }}>
          {closed.map((l) => (
            <li key={l.yearMonth} style={{ marginBottom: 10 }}>
              <b>{monthLabel(l.yearMonth)}</b> — closed
              {l.closedAt ? <span className="faint small"> on {formatDate(new Date(l.closedAt))}</span> : null}
              {isAdmin ? <ReopenMonthForm yearMonth={l.yearMonth} /> : null}
            </li>
          ))}
        </ul>
      )}
      {reopened.length > 0 ? (
        <p className="faint small" style={{ margin: "8px 0 0" }}>
          Reopened:{" "}
          {reopened
            .map(
              (l) =>
                `${monthLabel(l.yearMonth)}${l.reopenedAt ? ` on ${formatDate(new Date(l.reopenedAt))}` : ""}${
                  l.reopenReason ? ` — ${l.reopenReason}` : ""
                }`,
            )
            .join("; ")}
        </p>
      ) : null}
      {isAdmin ? (
        <CloseMonthForm defaultMonth={defaultMonth} />
      ) : (
        <p className="faint small" style={{ margin: "8px 0 0" }}>
          Only an Admin can close or reopen a month.
        </p>
      )}
    </div>
  );
}
