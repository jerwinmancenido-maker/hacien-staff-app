"use client";

import { useState } from "react";
import Link from "next/link";
import type { TaxCalendarRow } from "@/lib/tax/calendar-build";
import {
  TAX_CALENDAR_FILE_BY_PREFIX,
  TAX_CALENDAR_FILE_BY_SUFFIX,
} from "@/lib/tax/calendar-constants";
import { Chip, type ChipTone } from "@/components/ui";
import { TaxCalendarMarkDoneForm } from "@/components/books/TaxCalendarMarkDoneForm";
import { useFormAction } from "@/components/useFormAction";
import { markTaxCalendarDoneAction } from "@/app/(app)/books/tax/calendar/actions";

const STATUS_TONE: Record<string, ChipTone> = {
  upcoming: "grey",
  dueIn7: "amber",
  dueIn2: "amber",
  overdue: "red",
  markedDone: "green",
};

const APPLIES_TONE: Record<string, ChipTone> = {
  confirmed: "green",
  unverified: "amber",
  does_not_apply: "grey",
};

/** Open mark-as-done form laid out full-width under the table row. */
function OpenMarkDoneForm({
  r,
  doneDefault,
  onCancel,
}: {
  r: TaxCalendarRow;
  doneDefault: string;
  onCancel: () => void;
}) {
  const mark = useFormAction(markTaxCalendarDoneAction);
  return (
    <form
      noValidate
      className="stack tax-cal-mark-done-form"
      style={{ gap: 6 }}
      onSubmit={(ev) => {
        ev.preventDefault();
        mark.submit(ev.currentTarget);
      }}
    >
      <input type="hidden" name="occurrenceKey" value={r.occurrenceKey} />
      <input type="hidden" name="dueYmd" value={r.dueYmd ?? ""} />
      <label className="small">
        Done date
        <input name="doneDate" type="date" required defaultValue={mark.state.values?.doneDate ?? doneDefault} />
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
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-primary btn-sm" type="submit" disabled={mark.pending}>
          {mark.pending ? "Saving…" : "Save note"}
        </button>
        <button className="btn btn-sm" type="button" onClick={onCancel} disabled={mark.pending}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function DesktopRow({
  r,
  doneDefault,
}: {
  r: TaxCalendarRow;
  doneDefault: string;
}) {
  const [open, setOpen] = useState(false);
  const muted = r.notApplicable || r.applies === "does_not_apply" || r.greyedOut;
  const openBtnClass = muted ? "btn btn-secondary btn-sm" : "btn btn-sm";
  const showApplies = !!r.appliesLabel && r.applies !== "unverified";

  return (
    <>
      <tr className={muted ? "tax-cal-row-muted" : undefined}>
        <td className="tax-cal-form">
          <b>{r.form}</b>
          {r.description ? <div className="faint small tax-cal-plain">{r.description}</div> : null}
        </td>
        <td className="tax-cal-desc">
          <div>{r.description}</div>
          {r.tasks.length > 0 ? (
            <ul className="tax-cal-tasks" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {r.tasks.map((t) => (
                <li key={t} className="small">
                  {t}
                </li>
              ))}
            </ul>
          ) : null}
          {r.appliesNote ? <div className="faint small">{r.appliesNote}</div> : null}
          {r.worksheetLink ? (
            <div className="tax-cal-desc-worksheet">
              <Link href={r.worksheetLink}>Open worksheet</Link>
            </div>
          ) : null}
        </td>
        <td className="tax-cal-period">{r.periodLabel}</td>
        <td className="tax-cal-due">
          <div>{r.dueDisplay}</div>
          {r.fileByHint && r.fileByYmd ? (
            <div className="faint small tax-cal-fileby">
              {TAX_CALENDAR_FILE_BY_PREFIX}
              <span className="tax-cal-fileby-date">{r.fileByYmd}</span>
              {TAX_CALENDAR_FILE_BY_SUFFIX}
            </div>
          ) : r.fileByHint ? (
            <div className="faint small">{r.fileByHint}</div>
          ) : null}
        </td>
        <td className="tax-cal-status">
          <Chip tone={STATUS_TONE[r.status] ?? "grey"}>{r.statusLabel}</Chip>
        </td>
        <td className="tax-cal-applies">
          {showApplies ? (
            <Chip tone={APPLIES_TONE[r.applies] ?? "grey"}>{r.appliesLabel}</Chip>
          ) : (
            <span className="faint">—</span>
          )}
        </td>
        <td className="tax-cal-worksheet">
          {r.worksheetLink ? <Link href={r.worksheetLink}>Open worksheet</Link> : <span className="faint">—</span>}
        </td>
        <td className="tax-cal-done">
          {r.notApplicable ? (
            <span className="faint small">—</span>
          ) : r.markedDone ? (
            <TaxCalendarMarkDoneForm
              occurrenceKey={r.occurrenceKey}
              dueYmd={r.dueYmd}
              defaultDoneDate={doneDefault}
              markedDone={r.markedDone}
              doneDateYmd={r.doneDateYmd}
              doneNote={r.doneNote}
              secondary={muted}
            />
          ) : open ? null : (
            <button className={openBtnClass} type="button" onClick={() => setOpen(true)}>
              Mark as done
            </button>
          )}
        </td>
      </tr>
      {open && !r.markedDone && !r.notApplicable ? (
        <tr className="tax-cal-done-form-row">
          <td colSpan={8}>
            <OpenMarkDoneForm r={r} doneDefault={doneDefault} onCancel={() => setOpen(false)} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function TaxCalendarDesktopBody({
  rows,
  doneDefault,
}: {
  rows: TaxCalendarRow[];
  doneDefault: string;
}) {
  return (
    <tbody>
      {rows.map((r) => (
        <DesktopRow key={r.occurrenceKey} r={r} doneDefault={doneDefault} />
      ))}
    </tbody>
  );
}
