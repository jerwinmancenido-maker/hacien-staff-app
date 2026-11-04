"use client";

// S-50: "Return items" form: qty to return per received line, return date,
// reason, and the supplier's optional credit note (reference only — it never
// changes bill or payment amounts).
import { useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import type { FormState } from "@/lib/validation/forms";

export type ReturnLine = { id: string; description: string; unit: string; orderedQty: string; receivedQty: string };

const qty = (q: string) => q.replace(/\.00$/, "");

export function ReturnForm({
  lines,
  defaultDate,
  action,
  cancelHref,
}: {
  lines: ReturnLine[];
  defaultDate: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  cancelHref: string;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [h, setH] = useState({ returnDate: defaultDate, reason: "", creditNoteNumber: "", creditNoteAmount: "" });
  const e = state.fieldErrors ?? {};
  const payload = { ...h, lines: lines.map((l) => ({ lineId: l.id, qty: qtys[l.id] ?? "" })) };

  return (
    <form onSubmit={onSubmit} noValidate>
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      {state.message && (
        <div className={`alert ${state.ok ? "ok" : "error"}`} role="alert">
          {state.message}
        </div>
      )}
      <div className="card">
        <div className="card-head">
          <h2>Items to return</h2>
        </div>
        <div className="table-wrap">
          <table className="list" aria-label="Lines to return">
            <thead>
              <tr>
                <th>Description</th>
                <th className="num">Ordered</th>
                <th className="num">Received</th>
                <th className="num">Return now</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const err = e[`line.${l.id}`];
                const done = qty(l.receivedQty) === "0";
                return (
                  <tr key={l.id} className={done ? "inactive" : undefined}>
                    <td style={{ whiteSpace: "pre-wrap" }}>
                      {l.description}
                      {err && (
                        <div className="error small" role="alert">
                          {err}
                        </div>
                      )}
                    </td>
                    <td className="num">
                      {qty(l.orderedQty)} {l.unit}
                    </td>
                    <td className="num">{qty(l.receivedQty)}</td>
                    <td className={`num${err ? " has-error" : ""}`}>
                      <input
                        aria-label={`Return now: ${l.description}`}
                        inputMode="decimal"
                        className="w-num-s"
                        placeholder="0"
                        disabled={done}
                        value={qtys[l.id] ?? ""}
                        onChange={(ev) => setQtys({ ...qtys, [l.id]: ev.target.value })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h2>Return details</h2>
        <div className="form-grid">
          <div className={`field${e.returnDate ? " has-error" : ""}`}>
            <label htmlFor="returnDate">
              Return date<span className="req"> *</span>
            </label>
            <input id="returnDate" type="date" className="input" value={h.returnDate} onChange={(ev) => setH({ ...h, returnDate: ev.target.value })} />
            {e.returnDate && <div className="error">{e.returnDate}</div>}
          </div>
          <div className={`field${e.reason ? " has-error" : ""}`}>
            <label htmlFor="reason">Reason</label>
            <textarea id="reason" rows={2} value={h.reason} onChange={(ev) => setH({ ...h, reason: ev.target.value })} />
            {e.reason && <div className="error">{e.reason}</div>}
          </div>
          <div className={`field${e.creditNoteNumber ? " has-error" : ""}`}>
            <label htmlFor="creditNoteNumber">Supplier credit note no. (optional)</label>
            <input id="creditNoteNumber" type="text" value={h.creditNoteNumber} onChange={(ev) => setH({ ...h, creditNoteNumber: ev.target.value })} />
            {e.creditNoteNumber && <div className="error">{e.creditNoteNumber}</div>}
          </div>
          <div className={`field${e.creditNoteAmount ? " has-error" : ""}`}>
            <label htmlFor="creditNoteAmount">Credit note amount (optional)</label>
            <input id="creditNoteAmount" type="text" inputMode="decimal" value={h.creditNoteAmount} onChange={(ev) => setH({ ...h, creditNoteAmount: ev.target.value })} />
            {e.creditNoteAmount ? <div className="error">{e.creditNoteAmount}</div> : <div className="hint">Reference only — it does not change bill or payment amounts.</div>}
          </div>
        </div>
        <div className="form-actions">
          <a className="btn btn-secondary" href={cancelHref}>
            Cancel
          </a>
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Post return"}
          </button>
        </div>
      </div>
    </form>
  );
}
