"use client";

// Settings → Tax calendar: COR row + one table row per form (Show / Due day / Due month).

import { Fragment, useRef, useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { FormState } from "@/lib/validation/forms";
import {
  TAX_CALENDAR_OBLIGATIONS,
  obligationDueDayHint,
  obligationDueDayHintDefault,
  obligationDueDayHintIsShared,
  obligationDueMonthHint,
  type ObligationSettingsRow,
  type TaxCalendarObligationKey,
} from "@/lib/tax/calendar-obligations";

export type TaxCalendarFormProps = {
  label: string;
  versionId: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  corUploadedAndChecked: boolean;
  obligations: Record<TaxCalendarObligationKey, ObligationSettingsRow>;
  /** Intro copy shown inside the card (full width). */
  intro: string;
  /** COR checkbox hint (exact main wording with provisional banner). */
  corHint: string;
};

export function TaxCalendarForm({
  label,
  versionId,
  action,
  corUploadedAndChecked,
  obligations,
  intro,
  corHint,
}: TaxCalendarFormProps) {
  const { state, pending, submit } = useFormAction(action);
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const e = state.fieldErrors ?? {};
  const sharedDayHint = obligationDueDayHintDefault();
  const monthHint = obligationDueMonthHint();

  const checked = (name: string, fallback: boolean) => {
    const echoed = state.values?.[name];
    if (echoed !== undefined) return echoed === "true";
    return fallback;
  };

  const numVal = (name: string, fallback: number | null) => {
    const echoed = state.values?.[name];
    if (echoed !== undefined) return echoed;
    return fallback == null ? "" : String(fallback);
  };

  return (
    <div className="card settings-section tax-cal-card">
      <h2 className="settings-section-title">Tax calendar</h2>
      <p className="settings-tax-cal-intro">{intro}</p>
      <form
        ref={formRef}
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          setConfirming(true);
        }}
      >
        {state.message && (
          <div className={`alert ${state.ok ? "ok" : "error"}`} role="status">
            {state.message}
          </div>
        )}
        <input type="hidden" name="baseVersionId" value={versionId} />

        <div className={`settings-cor-row${e.corUploadedAndChecked ? " has-error" : ""}`}>
          <label className="check settings-cor-check" htmlFor="corUploadedAndChecked">
            <input type="hidden" name="corUploadedAndChecked" value="false" />
            <input
              id="corUploadedAndChecked"
              name="corUploadedAndChecked"
              type="checkbox"
              value="true"
              defaultChecked={checked("corUploadedAndChecked", corUploadedAndChecked)}
            />
            <span className="settings-cor-label">COR uploaded and checked</span>
          </label>
          {e.corUploadedAndChecked ? (
            <div className="error" role="alert">
              {e.corUploadedAndChecked}
            </div>
          ) : (
            <div className="hint">{corHint}</div>
          )}
        </div>

        <div className="tax-cal-settings-wrap">
          {/* Shared default hints once on phone (desktop shows them under column headers). */}
          <div className="tax-cal-shared-hints-mobile" data-shared-hints="mobile">
            <div className="hint">{sharedDayHint}</div>
            <div className="hint">{monthHint}</div>
          </div>
          <table className="tax-cal-settings-table">
            <thead>
              <tr>
                <th scope="col">Form</th>
                <th scope="col">Show</th>
                <th scope="col" className="tax-cal-settings-day-head">
                  <span className="tax-cal-th-label">Due day of month</span>
                  <div className="hint tax-cal-col-hint" data-shared-hint="due-day">
                    {sharedDayHint}
                  </div>
                </th>
                <th scope="col" className="tax-cal-settings-month-head">
                  <span className="tax-cal-th-label">Due month (annual / year-end)</span>
                  <div className="hint tax-cal-col-hint" data-shared-hint="due-month">
                    {monthHint}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {TAX_CALENDAR_OBLIGATIONS.map((def) => {
                const o = obligations[def.key];
                const enabledName = `obligations.${def.key}.enabled`;
                const dueDayName = `obligations.${def.key}.dueDay`;
                const dueMonthName = `obligations.${def.key}.dueMonth`;
                const dayHint = obligationDueDayHint(def);
                const showRowDayHint = !obligationDueDayHintIsShared(def);
                const showLabel = `Show ${def.form} on the calendar`;
                const dayErr = e[dueDayName];
                const monthErr = e[dueMonthName];
                return (
                  <Fragment key={def.key}>
                    <tr data-obligation={def.key} data-uses-due-month="1" data-schedule={def.schedule.kind}>
                      <td className="tax-cal-settings-form" data-label="Form">
                        <span className="strong">
                          {def.form} {def.description}
                        </span>
                        <div className="hint tax-cal-source-note">{def.sourceNote}</div>
                      </td>
                      <td className="tax-cal-settings-show" data-label="Show">
                        <label className="check tax-cal-show-toggle" htmlFor={enabledName}>
                          <input type="hidden" name={enabledName} value="false" />
                          <input
                            id={enabledName}
                            name={enabledName}
                            type="checkbox"
                            value="true"
                            defaultChecked={checked(enabledName, o.enabled)}
                          />
                          {/* Short visible chrome; full main wording for assistive tech. */}
                          <span className="tax-cal-show-text" aria-hidden="true">
                            Show
                          </span>
                          <span className="sr-only">{showLabel}</span>
                        </label>
                      </td>
                      <td className={`tax-cal-settings-day${dayErr ? " has-error" : ""}`} data-label="Due day of month">
                        <label className="sr-only" htmlFor={dueDayName}>
                          Due day of month
                        </label>
                        <input
                          id={dueDayName}
                          name={dueDayName}
                          type="number"
                          step="1"
                          min={1}
                          max={31}
                          defaultValue={numVal(dueDayName, o.dueDay)}
                        />
                        {dayErr ? (
                          <div className="error" role="alert">
                            {dayErr}
                          </div>
                        ) : showRowDayHint ? (
                          <div className="hint tax-cal-row-day-hint">{dayHint}</div>
                        ) : null}
                      </td>
                      <td
                        className={`tax-cal-settings-month${monthErr ? " has-error" : ""}`}
                        data-label="Due month (annual / year-end)"
                      >
                        <label className="sr-only" htmlFor={dueMonthName}>
                          Due month (annual / year-end)
                        </label>
                        <input
                          id={dueMonthName}
                          name={dueMonthName}
                          type="number"
                          step="1"
                          min={1}
                          max={12}
                          defaultValue={numVal(dueMonthName, o.dueMonth)}
                        />
                        {monthErr ? (
                          <div className="error" role="alert">
                            {monthErr}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="form-actions settings-form-actions">
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
      <ConfirmDialog
        open={confirming}
        title={`Change ${label}?`}
        body="This saves a new settings version. Documents already made keep the old values."
        confirmLabel="Save changes"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          if (formRef.current) submit(formRef.current);
        }}
      />
    </div>
  );
}
