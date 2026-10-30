"use client";

import { useFormAction } from "@/components/useFormAction";
import { saveTaxPaidAction } from "@/app/(app)/books/tax/actions";

/** Manual entry for tax actually paid for a quarter (saved with audit log). */
export function TaxPaidForm({
  year,
  quarter,
  amountPaid,
}: {
  year: number;
  quarter: number;
  amountPaid: string;
}) {
  const { state, pending, submit } = useFormAction(saveTaxPaidAction);
  return (
    <form
      noValidate
      className="stack"
      style={{ gap: 8, marginTop: 8 }}
      onSubmit={(ev) => {
        ev.preventDefault();
        submit(ev.currentTarget);
      }}
    >
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="quarter" value={quarter} />
      <label className="small">
        Tax paid for Q{quarter} {year} (₱)
        <input
          name="amountPaid"
          type="text"
          inputMode="decimal"
          defaultValue={state.values?.amountPaid ?? amountPaid}
          required
          aria-label={`Tax paid for Q${quarter} ${year}`}
        />
      </label>
      {state.fieldErrors?.amountPaid ? (
        <div className="field-error">{state.fieldErrors.amountPaid}</div>
      ) : null}
      <label className="small">
        Notes (optional)
        <input name="notes" type="text" defaultValue={state.values?.notes ?? ""} maxLength={500} />
      </label>
      {state.message ? (
        <div className={state.ok ? "alert ok" : "alert error"} role="status">
          {state.message}
        </div>
      ) : null}
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save tax paid"}
      </button>
      <p className="faint small" style={{ margin: 0 }}>
        Saved with an audit log. Earlier quarters&apos; saved amounts feed line (e) on later worksheets.
      </p>
    </form>
  );
}
