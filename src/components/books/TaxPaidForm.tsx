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
      style={{ gap: 12, marginTop: 8 }}
      onSubmit={(ev) => {
        ev.preventDefault();
        submit(ev.currentTarget);
      }}
    >
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="quarter" value={quarter} />
      <div className="field" style={{ maxWidth: 360 }}>
        <label htmlFor="amountPaid" style={{ fontWeight: 600, display: "block", marginBottom: 6 }}>
          Tax paid this quarter (₱)
        </label>
        <input
          id="amountPaid"
          name="amountPaid"
          type="text"
          inputMode="decimal"
          defaultValue={state.values?.amountPaid ?? amountPaid}
          required
          aria-label={`Tax paid for Q${quarter} ${year}`}
          style={{ fontSize: "1.125rem", padding: "10px 12px", width: "100%", maxWidth: 280 }}
        />
        <div className="hint">Amount actually paid for Q{quarter} {year} (from bank / OR).</div>
      </div>
      {state.fieldErrors?.amountPaid ? (
        <div className="field-error">{state.fieldErrors.amountPaid}</div>
      ) : null}
      <div className="field" style={{ maxWidth: 480 }}>
        <label htmlFor="notes" style={{ fontWeight: 600, display: "block", marginBottom: 6 }}>
          Notes (optional)
        </label>
        <input
          id="notes"
          name="notes"
          type="text"
          defaultValue={state.values?.notes ?? ""}
          maxLength={500}
          style={{ padding: "10px 12px", width: "100%" }}
        />
      </div>
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
