"use client";

// Audit (2026-11-05): record how the customer accepted the quote — date,
// name, and how — for quotes with no signed conforme file and no buyer PO
// number. Conversion to a sales order needs one of the three.
import { useFormAction } from "@/components/useFormAction";
import { ACCEPTANCE_VIA_OPTIONS } from "@/lib/quotes/acceptance";
import type { FormState } from "@/lib/validation/forms";

export function AcceptanceForm({ action }: { action: (s: FormState, f: FormData) => Promise<FormState> }) {
  const { state, pending, onSubmit } = useFormAction(action);
  const e = state.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} noValidate>
      {state.message && (
        <div className={`alert ${state.ok ? "ok" : "error"}`} role="status">
          {state.message}
        </div>
      )}
      <p className="faint">No signed conforme and no buyer PO yet. Record how the customer accepted so this quote can convert to a sales order.</p>
      <div className="field">
        <label htmlFor="accepted-at">Date accepted</label>
        <input id="accepted-at" name="acceptedAt" type="date" required />
        {e.acceptedAt && <div className="error">{e.acceptedAt}</div>}
      </div>
      <div className="field">
        <label htmlFor="accepted-by">Accepted by (customer name)</label>
        <input id="accepted-by" name="acceptedBy" type="text" maxLength={128} required autoComplete="off" />
        {e.acceptedBy && <div className="error">{e.acceptedBy}</div>}
      </div>
      <div className="field">
        <label htmlFor="accepted-via">How did they accept?</label>
        <select id="accepted-via" name="acceptedVia" required defaultValue="EMAIL">
          {ACCEPTANCE_VIA_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {e.acceptedVia && <div className="error">{e.acceptedVia}</div>}
      </div>
      <div className="form-actions">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Record acceptance"}
        </button>
      </div>
    </form>
  );
}
