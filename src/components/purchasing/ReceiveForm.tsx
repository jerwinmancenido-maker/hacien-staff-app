"use client";

// "Receive items" form: open qty per line, qty received now (0 / blank = skip),
// date, who received, supplier DR no., notes and optional files. Quantities
// only — no prices. The server re-checks remaining quantities under a row lock.

import { useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import type { FormState } from "@/lib/validation/forms";

export type ReceiveLine = { id: string; description: string; unit: string; orderedQty: string; receivedQty: string; remainingQty: string };

const qty = (q: string) => q.replace(/\.00$/, "");

export function ReceiveForm({
  lines,
  users,
  defaultUserId,
  defaultDate,
  action,
  cancelHref,
  maxMb,
}: {
  lines: ReceiveLine[];
  users: { id: string; name: string }[];
  defaultUserId: string;
  defaultDate: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  cancelHref: string;
  maxMb: number;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [h, setH] = useState({ receivedDate: defaultDate, receivedById: defaultUserId, deliveryRef: "", notes: "" });
  const e = state.fieldErrors ?? {};
  const payload = { ...h, lines: lines.map((l) => ({ lineId: l.id, qty: qtys[l.id] ?? "" })) };
  const fillAll = () => setQtys(Object.fromEntries(lines.map((l) => [l.id, qty(l.remainingQty) === "0" ? "" : qty(l.remainingQty)])));

  return (
    <form onSubmit={onSubmit} noValidate encType="multipart/form-data">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      {state.message && (
        <div className={`alert ${state.ok ? "ok" : "error"}`} role="alert">
          {state.message}
        </div>
      )}
      <div className="card">
        <div className="card-head">
          <h2>Items received</h2>
          <div className="right">
            <button type="button" className="btn btn-secondary btn-sm" onClick={fillAll}>
              Receive all remaining
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="list" aria-label="Lines to receive">
            <thead>
              <tr>
                <th>Description</th>
                <th className="num">Ordered</th>
                <th className="num">Received</th>
                <th className="num">Remaining</th>
                <th className="num">Receive now</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const err = e[`line.${l.id}`];
                const done = qty(l.remainingQty) === "0";
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
                    <td className="num strong">{qty(l.remainingQty)}</td>
                    <td className={`num${err ? " has-error" : ""}`}>
                      <input
                        aria-label={`Receive now: ${l.description}`}
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
        <h2>Delivery details</h2>
        <div className="form-grid">
          <div className={`field${e.receivedDate ? " has-error" : ""}`}>
            <label htmlFor="receivedDate">
              Received date<span className="req"> *</span>
            </label>
            <input id="receivedDate" type="date" className="input" value={h.receivedDate} onChange={(ev) => setH({ ...h, receivedDate: ev.target.value })} />
            {e.receivedDate && <div className="error">{e.receivedDate}</div>}
          </div>
          <div className={`field${e.receivedById ? " has-error" : ""}`}>
            <label htmlFor="receivedById">Received by</label>
            <select id="receivedById" value={h.receivedById} onChange={(ev) => setH({ ...h, receivedById: ev.target.value })}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            {e.receivedById && <div className="error">{e.receivedById}</div>}
          </div>
          <div className={`field${e.deliveryRef ? " has-error" : ""}`}>
            <label htmlFor="deliveryRef">Supplier DR no.</label>
            <input id="deliveryRef" type="text" value={h.deliveryRef} onChange={(ev) => setH({ ...h, deliveryRef: ev.target.value })} />
            {e.deliveryRef && <div className="error">{e.deliveryRef}</div>}
          </div>
          <div className={`field${e.files ? " has-error" : ""}`}>
            <label htmlFor="files">Attachments</label>
            <input id="files" name="files" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" />
            {e.files ? <div className="error">{e.files}</div> : <div className="hint">Delivery receipt photo or scan. PDF, JPG or PNG, up to {maxMb} MB each.</div>}
          </div>
          <div className="field full">
            <label htmlFor="notes">Notes</label>
            <textarea id="notes" rows={2} value={h.notes} onChange={(ev) => setH({ ...h, notes: ev.target.value })} />
          </div>
        </div>
      </div>
      <div className="form-actions">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Posting…" : "Post receiving report"}
        </button>
        <a className="btn btn-secondary" href={cancelHref}>
          Cancel
        </a>
      </div>
    </form>
  );
}
