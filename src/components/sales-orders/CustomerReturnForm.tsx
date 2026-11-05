"use client";

// Audit D: "Record return" form: qty to return per delivered line, return
// date, and reason. The returned value (qty x unit price) becomes customer
// credit that can be applied to an open billing.
import { useMemo, useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import type { FormState } from "@/lib/validation/forms";
import { formatPeso } from "@/lib/format";
import { fromScaled, toScaled } from "@/lib/quotes/calc";

export type CustomerReturnLine = {
  id: string;
  description: string;
  unit: string;
  orderedQty: string;
  deliveredQty: string;
  unitPrice: string;
};

const qty = (q: string) => q.replace(/\.00$/, "");

export function CustomerReturnForm({
  lines,
  defaultDate,
  action,
  cancelHref,
}: {
  lines: CustomerReturnLine[];
  defaultDate: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  cancelHref: string;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [h, setH] = useState({ returnDate: defaultDate, reason: "" });
  const e = state.fieldErrors ?? {};
  const payload = { ...h, lines: lines.map((l) => ({ lineId: l.id, qty: qtys[l.id] ?? "" })) };

  const creditTotal = useMemo(() => {
    let total = 0n;
    for (const l of lines) {
      const raw = (qtys[l.id] ?? "").trim().replace(/,/g, "");
      if (!/^\d{1,10}(\.\d{1,2})?$/.test(raw)) continue;
      // Qty x price, rounded half away from zero — same as the server's lineAmounts.
      total += (toScaled(raw, 2) * toScaled(l.unitPrice, 2) + 50n) / 100n;
    }
    return fromScaled(total, 2);
  }, [lines, qtys]);

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
                <th className="num">Delivered</th>
                <th className="num">Unit price</th>
                <th className="num">Return now</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const err = e[`line.${l.id}`];
                const done = qty(l.deliveredQty) === "0";
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
                    <td className="num">{qty(l.deliveredQty)}</td>
                    <td className="num">{formatPeso(l.unitPrice)}</td>
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
        <p className="hint">
          Credit for the returned goods: <b>{formatPeso(creditTotal)}</b> — it becomes customer credit that can be
          applied to an open billing.
        </p>
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
