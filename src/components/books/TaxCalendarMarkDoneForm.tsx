"use client";

import { useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import { markTaxCalendarDoneAction, undoTaxCalendarDoneAction } from "@/app/(app)/books/tax/calendar/actions";

/** Mark-as-done is a staff note only — not a filing. */
export function TaxCalendarMarkDoneForm({
  occurrenceKey,
  dueYmd,
  defaultDoneDate,
  markedDone,
  doneDateYmd,
  doneNote,
  secondary = false,
}: {
  occurrenceKey: string;
  dueYmd: string | null;
  defaultDoneDate: string;
  markedDone: boolean;
  doneDateYmd: string | null;
  doneNote: string | null;
  /** Outline style (e.g. does-not-apply rows) so opacity fade does not look disabled. */
  secondary?: boolean;
}) {
  const mark = useFormAction(markTaxCalendarDoneAction);
  const undo = useFormAction(undoTaxCalendarDoneAction);
  const [open, setOpen] = useState(false);
  const openBtnClass = secondary ? "btn btn-secondary btn-sm" : "btn btn-sm";

  if (markedDone) {
    return (
      <div className="stack" style={{ gap: 6 }}>
        <div className="small">
          Done {doneDateYmd ? <span className="tax-cal-done-date">{doneDateYmd}</span> : null}
          {doneNote ? ` — ${doneNote}` : ""}
        </div>
        <form
          noValidate
          onSubmit={(ev) => {
            ev.preventDefault();
            undo.submit(ev.currentTarget);
          }}
        >
          <input type="hidden" name="occurrenceKey" value={occurrenceKey} />
          <button className="btn btn-secondary btn-sm" type="submit" disabled={undo.pending}>
            {undo.pending ? "Undoing…" : "Undo"}
          </button>
        </form>
        {undo.state.message ? (
          <div className={undo.state.ok ? "alert ok" : "alert error"} role="status">
            {undo.state.message}
          </div>
        ) : null}
      </div>
    );
  }

  if (!open) {
    return (
      <button className={openBtnClass} type="button" onClick={() => setOpen(true)}>
        Mark as done
      </button>
    );
  }

  return (
    <form
      noValidate
      className="stack"
      style={{ gap: 6 }}
      onSubmit={(ev) => {
        ev.preventDefault();
        mark.submit(ev.currentTarget);
      }}
    >
      <input type="hidden" name="occurrenceKey" value={occurrenceKey} />
      <input type="hidden" name="dueYmd" value={dueYmd ?? ""} />
      <label className="small">
        Done date
        <input name="doneDate" type="date" required defaultValue={mark.state.values?.doneDate ?? defaultDoneDate} />
      </label>
      {mark.state.fieldErrors?.doneDate ? (
        <div className="field-error">{mark.state.fieldErrors.doneDate}</div>
      ) : null}
      <label className="small">
        Note (optional)
        <input name="note" type="text" maxLength={2000} defaultValue={mark.state.values?.note ?? ""} />
      </label>
      <p className="faint small" style={{ margin: 0 }}>
        Staff note only — not a filing. Saved with an audit log; can be undone.
      </p>
      {mark.state.message ? (
        <div className={mark.state.ok ? "alert ok" : "alert error"} role="status">
          {mark.state.message}
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary btn-sm" type="submit" disabled={mark.pending}>
          {mark.pending ? "Saving…" : "Save note"}
        </button>
        <button className="btn btn-sm" type="button" onClick={() => setOpen(false)} disabled={mark.pending}>
          Cancel
        </button>
      </div>
    </form>
  );
}
