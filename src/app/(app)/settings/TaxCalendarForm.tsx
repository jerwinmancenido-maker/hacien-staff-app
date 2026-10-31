"use client";

// Settings → Tax calendar: COR row + one table row per form (Show / Due day / Due month).

import { Fragment, useRef, useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { FormState } from "@/lib/validation/forms";
import {
  TAX_CALENDAR_OBLIGATIONS,
  obligationDueDayHint,
  obligationUsesDueMonth,
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
};

export function TaxCalendarForm({
  label,
  versionId,
  action,
  corUploadedAndChecked,
  obligations,
  intro,
}: TaxCalendarFormProps) {
  const { state, pending, submit } = useFormAction(action);
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const e = state.fieldErrors ?? {};

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
            <div className="hint">
              When off, the calendar shows the provisional notice until COR is checked.
            </div>
          )}
        </div>

        <div className="tax-cal-settings-wrap">
          <table className="tax-cal-settings-table">
            <thead>
              <tr>
                <th scope="col">Form</th>
                <th scope="col">Show</th>
                <th scope="col">Due day (1–31)</th>
                <th scope="col">Due month (1–12)</th>
              </tr>
            </thead>
            <tbody>
              {TAX_CALENDAR_OBLIGATIONS.map((def) => {
                const o = obligations[def.key];
                const enabledName = `obligations.${def.key}.enabled`;
                const dueDayName = `obligations.${def.key}.dueDay`;
                const dueMonthName = `obligations.${def.key}.dueMonth`;
                const showMonth = obligationUsesDueMonth(def);
                const dayHint = obligationDueDayHint(def);
                const dayErr = e[dueDayName];
                const monthErr = e[dueMonthName];
                return (
                  <Fragment key={def.key}>
                    <tr data-obligation={def.key} data-uses-due-month={showMonth ? "1" : "0"}>
                      <td className="tax-cal-settings-form" data-label="Form">
                        <span className="strong">
                          {def.form} {def.description}
                        </span>
                      </td>
                      <td className="tax-cal-settings-show" data-label="Show">
                        <label className="check tax-cal-show-toggle" htmlFor={enabledName}>
                          <input type="hidden" name={enabledName} value="false" />
                          <input
                            id={enabledName}
                            name={enabledName}
                            type="checkbox"
                            value="true"
                            aria-label={`Show ${def.form}`}
                            defaultChecked={checked(enabledName, o.enabled)}
                          />
                          <span className="tax-cal-show-text">Show</span>
                        </label>
                      </td>
                      <td className={`tax-cal-settings-day${dayErr ? " has-error" : ""}`} data-label="Due day (1–31)">
                        <label className="sr-only" htmlFor={dueDayName}>
                          Due day for {def.form}
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
                        {dayErr && (
                          <div className="error" role="alert">
                            {dayErr}
                          </div>
                        )}
                      </td>
                      <td
                        className={`tax-cal-settings-month${monthErr ? " has-error" : ""}`}
                        data-label="Due month (1–12)"
                      >
                        {showMonth ? (
                          <>
                            <label className="sr-only" htmlFor={dueMonthName}>
                              Due month for {def.form}
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
                            {monthErr && (
                              <div className="error" role="alert">
                                {monthErr}
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <input type="hidden" name={dueMonthName} value={numVal(dueMonthName, o.dueMonth)} />
                            <span className="tax-cal-month-na" data-empty="1" />
                            <span className="sr-only">Due month not used for this form</span>
                          </>
                        )}
                      </td>
                    </tr>
                    {dayHint && !dayErr ? (
                      <tr className="tax-cal-hint-row" data-hint-for={def.key}>
                        <td colSpan={2} className="tax-cal-hint-pad" aria-hidden="true" />
                        <td colSpan={2} className="tax-cal-hint-cell">
                          <div className="hint">{dayHint}</div>
                        </td>
                      </tr>
                    ) : null}
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
