"use client";

// Record a supplier bill against a PO: the supplier's bill no., date, amount,
// notes, optional per-line qty / unit price (for the 3-way match) and files.

import { useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import { formatPeso } from "@/lib/format";
import { fromScaled, lineAmounts, toScaled } from "@/lib/quotes/calc";
import type { FormState } from "@/lib/validation/forms";

export type BillLine = { id: string; description: string; unit: string; qty: string; unitCost: string; receivedQty: string };

const qty = (q: string) => q.replace(/\.00$/, "");
function safeTotal(q: string, p: string) {
  try {
    return lineAmounts({ kind: "GOODS", qty: q || "0", unitPrice: p || "0", supplierUnitCost: "0" }).total;
  } catch {
    return "0.00";
  }
}

export function BillForm({ lines, defaultDate, action, cancelHref, maxMb }: { lines: BillLine[]; defaultDate: string; action: (state: FormState, form: FormData) => Promise<FormState>; cancelHref: string; maxMb: number }) {
  const { state, pending, onSubmit } = useFormAction(action);
  const [h, setH] = useState({ billNumber: "", billDate: defaultDate, amount: "", notes: "" });
  const [rows, setRows] = useState<Record<string, { qty: string; unitPrice: string }>>({});
  const e = state.fieldErrors ?? {};
  const linesTotal = fromScaled(
    lines.reduce((a, l) => a + toScaled(safeTotal(rows[l.id]?.qty ?? "", rows[l.id]?.unitPrice ?? ""), 2), 0n),
    2,
  );
  const payload = { ...h, lines: lines.map((l) => ({ purchaseOrderItemId: l.id, qty: rows[l.id]?.qty ?? "", unitPrice: rows[l.id]?.unitPrice ?? "" })) };
  const set = (id: string, patch: Partial<{ qty: string; unitPrice: string }>) => setRows({ ...rows, [id]: { qty: "", unitPrice: "", ...rows[id], ...patch } });
  const fillReceived = () => setRows(Object.fromEntries(lines.map((l) => [l.id, { qty: qty(l.receivedQty) === "0" ? "" : qty(l.receivedQty), unitPrice: l.unitCost }])));

  return (
    <form onSubmit={onSubmit} noValidate encType="multipart/form-data">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      {state.message && (
        <div className={`alert ${state.ok ? "ok" : "error"}`} role="alert">
          {state.message}
        </div>
      )}
      <div className="card">
        <h2>Bill</h2>
        <div className="form-grid">
          <div className={`field${e.billNumber ? " has-error" : ""}`}>
            <label htmlFor="billNumber">
              Supplier bill / invoice no.<span className="req"> *</span>
            </label>
            <input id="billNumber" type="text" value={h.billNumber} onChange={(ev) => setH({ ...h, billNumber: ev.target.value })} />
            {e.billNumber && <div className="error">{e.billNumber}</div>}
          </div>
          <div className={`field${e.billDate ? " has-error" : ""}`}>
            <label htmlFor="billDate">
              Bill date<span className="req"> *</span>
            </label>
            <input id="billDate" type="date" className="input" value={h.billDate} onChange={(ev) => setH({ ...h, billDate: ev.target.value })} />
            {e.billDate && <div className="error">{e.billDate}</div>}
          </div>
          <div className={`field${e.amount ? " has-error" : ""}`}>
            <label htmlFor="amount">
              Amount<span className="req"> *</span>
            </label>
            <input id="amount" inputMode="decimal" value={h.amount} onChange={(ev) => setH({ ...h, amount: ev.target.value })} />
            {e.amount ? <div className="error">{e.amount}</div> : <div className="hint">The bill total as printed by the supplier.</div>}
          </div>
          <div className={`field${e.files ? " has-error" : ""}`}>
            <label htmlFor="files">Attachments</label>
            <input id="files" name="files" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" />
            {e.files ? <div className="error">{e.files}</div> : <div className="hint">Invoice scan. PDF, JPG or PNG, up to {maxMb} MB each.</div>}
          </div>
          <div className="field full">
            <label htmlFor="notes">Notes</label>
            <textarea id="notes" rows={2} value={h.notes} onChange={(ev) => setH({ ...h, notes: ev.target.value })} />
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <h2>Billed lines (optional)</h2>
          <div className="right">
            <button type="button" className="btn btn-secondary btn-sm" onClick={fillReceived}>
              Fill from received qty
            </button>
          </div>
        </div>
        <p className="small muted">Enter what the bill charges per line to match it against the PO and receiving. Leave blank to match on the total only.</p>
        {e.lines && (
          <div className="alert error" role="alert">
            {e.lines}
          </div>
        )}
        <div className="table-wrap">
          <table className="list" aria-label="Billed lines">
            <thead>
              <tr>
                <th>Description</th>
                <th className="num">PO qty</th>
                <th className="num">Received</th>
                <th className="num">PO unit cost</th>
                <th className="num">Billed qty</th>
                <th className="num">Billed unit price</th>
                <th className="num">Billed total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td style={{ whiteSpace: "pre-wrap" }}>{l.description}</td>
                  <td className="num">
                    {qty(l.qty)} {l.unit}
                  </td>
                  <td className="num">{qty(l.receivedQty)}</td>
                  <td className="num">{formatPeso(l.unitCost)}</td>
                  <td className="num">
                    <input aria-label={`Billed qty: ${l.description}`} inputMode="decimal" className="w-num-s" value={rows[l.id]?.qty ?? ""} onChange={(ev) => set(l.id, { qty: ev.target.value })} />
                  </td>
                  <td className="num">
                    <input aria-label={`Billed unit price: ${l.description}`} inputMode="decimal" className="w-num" value={rows[l.id]?.unitPrice ?? ""} onChange={(ev) => set(l.id, { unitPrice: ev.target.value })} />
                  </td>
                  <td className="num strong">{formatPeso(safeTotal(rows[l.id]?.qty ?? "", rows[l.id]?.unitPrice ?? ""))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={6} className="num">
                  Sum of billed lines
                </th>
                <th className="num">{formatPeso(linesTotal)}</th>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="small muted" style={{ marginTop: 8 }}>
          Payments: later.
        </div>
      </div>
      <div className="form-actions">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Record bill"}
        </button>
        <a className="btn btn-secondary" href={cancelHref}>
          Cancel
        </a>
      </div>
    </form>
  );
}
