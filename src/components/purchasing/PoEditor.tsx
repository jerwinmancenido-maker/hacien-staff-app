"use client";

// PO editor (standalone new PO, or editing a Draft/Approved PO). Totals here are
// a preview; the server recomputes and stores them on save. Lines that came
// from a sales order keep their link when edited.

import { useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import { formatPeso } from "@/lib/format";
import { fromScaled, lineAmounts, toScaled, type ItemKind } from "@/lib/quotes/calc";
import type { FormState } from "@/lib/validation/forms";

export type PoEditorSupplier = { id: string; name: string; defaultTerms: string | null; address: string | null; contacts: { id: string; name: string; isMain: boolean }[] };

export type PoEditorItem = { id: string | null; description: string; kind: ItemKind; qty: string; unit: string; unitCost: string; linked?: boolean };

export type PoEditorInitial = {
  supplierId: string;
  supplierContactId: string;
  date: string;
  expectedDate: string;
  terms: string;
  deliveryAddressText: string;
  supplierAddressText: string;
  notes: string;
  items: PoEditorItem[];
};

let seq = 0;
const newKey = () => `p${++seq}`;
type Row = PoEditorItem & { key: string };
const blank = (): Row => ({ key: newKey(), id: null, description: "", kind: "GOODS", qty: "1", unit: "pc", unitCost: "" });

function safeTotal(i: PoEditorItem) {
  try {
    return lineAmounts({ kind: i.kind, qty: i.qty || "0", unitPrice: i.unitCost || "0", supplierUnitCost: "0" }).total;
  } catch {
    return "0.00";
  }
}

export function PoEditor({
  isNew,
  initial,
  suppliers,
  termsOptions,
  status,
  action,
  cancelHref,
}: {
  isNew: boolean;
  initial: PoEditorInitial;
  suppliers: PoEditorSupplier[];
  termsOptions: string[];
  status?: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  cancelHref: string;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const [h, setH] = useState(() => ({ ...initial }));
  const [items, setItems] = useState<Row[]>(() => (initial.items.length ? initial.items.map((i) => ({ ...i, key: newKey() })) : [blank()]));
  const e = state.fieldErrors ?? {};
  const supplier = suppliers.find((s) => s.id === h.supplierId);
  const terms = h.terms && !termsOptions.includes(h.terms) ? [...termsOptions, h.terms] : termsOptions;
  const subtotal = fromScaled(
    items.reduce((acc, i) => acc + toScaled(safeTotal(i), 2), 0n),
    2,
  );
  const setItem = (key: string, patch: Partial<Row>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  function pickSupplier(id: string) {
    const s = suppliers.find((x) => x.id === id);
    setH((v) => ({
      ...v,
      supplierId: id,
      supplierContactId: s?.contacts.find((c) => c.isMain)?.id ?? "",
      terms: s?.defaultTerms ?? v.terms,
      supplierAddressText: s?.address ?? "",
    }));
  }

  const payload = {
    supplierId: h.supplierId,
    supplierContactId: h.supplierContactId || null,
    date: h.date,
    expectedDate: h.expectedDate,
    terms: h.terms,
    deliveryAddressText: h.deliveryAddressText,
    supplierAddressText: h.supplierAddressText,
    notes: h.notes,
    items: items.map((i) => ({ id: i.id, description: i.description, kind: i.kind, qty: i.qty, unit: i.unit, unitCost: i.unitCost })),
  };
  const itemErrors = Object.entries(e).filter(([k]) => k.startsWith("items"));

  return (
    <form onSubmit={onSubmit} noValidate>
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      {state.message && (
        <div className={`alert ${state.ok ? "ok" : "error"}`} role="status">
          {state.message}
        </div>
      )}
      {status === "APPROVED" && (
        <div className="alert warn" role="note">
          This PO is approved. Saving changes returns it to <b>Draft</b>: it needs approval again and its revision goes up.
        </div>
      )}
      <div className="card">
        <h2>PO details</h2>
        <div className="form-grid">
          {isNew ? (
            <div className={`field${e.supplierId ? " has-error" : ""}`}>
              <label htmlFor="supplierId">
                Supplier<span className="req"> *</span>
              </label>
              <select id="supplierId" value={h.supplierId} onChange={(ev) => pickSupplier(ev.target.value)}>
                <option value="">Pick a supplier…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {e.supplierId && <div className="error">{e.supplierId}</div>}
            </div>
          ) : (
            <div className="field">
              <span className="label">Supplier</span>
              <div className="strong" style={{ padding: "8px 0" }}>
                {supplier?.name}
              </div>
            </div>
          )}
          <div className={`field${e.supplierContactId ? " has-error" : ""}`}>
            <label htmlFor="supplierContactId">Supplier contact</label>
            <select id="supplierContactId" value={h.supplierContactId} onChange={(ev) => setH({ ...h, supplierContactId: ev.target.value })} disabled={!supplier}>
              <option value="">None</option>
              {(supplier?.contacts ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.isMain ? " (main)" : ""}
                </option>
              ))}
            </select>
            {e.supplierContactId && <div className="error">{e.supplierContactId}</div>}
          </div>
          <div className={`field${e.date ? " has-error" : ""}`}>
            <label htmlFor="date">
              PO date<span className="req"> *</span>
            </label>
            <input id="date" type="date" className="input" value={h.date} onChange={(ev) => setH({ ...h, date: ev.target.value })} />
            {e.date ? <div className="error">{e.date}</div> : isNew && <div className="hint">The number (PO-year-####) is given when you save.</div>}
          </div>
          <div className={`field${e.expectedDate ? " has-error" : ""}`}>
            <label htmlFor="expectedDate">Expected delivery</label>
            <input id="expectedDate" type="date" className="input" value={h.expectedDate} onChange={(ev) => setH({ ...h, expectedDate: ev.target.value })} />
            {e.expectedDate && <div className="error">{e.expectedDate}</div>}
          </div>
          <div className="field">
            <label htmlFor="terms">Terms</label>
            <select id="terms" value={h.terms} onChange={(ev) => setH({ ...h, terms: ev.target.value })}>
              <option value="">None</option>
              {terms.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="field full">
            <label htmlFor="deliveryAddressText">Deliver to</label>
            <textarea id="deliveryAddressText" rows={3} value={h.deliveryAddressText} onChange={(ev) => setH({ ...h, deliveryAddressText: ev.target.value })} />
            <div className="hint">Saved on the PO as typed.</div>
          </div>
          <div className="field full">
            <label htmlFor="supplierAddressText">Supplier address (on the PO)</label>
            <textarea id="supplierAddressText" rows={3} value={h.supplierAddressText} onChange={(ev) => setH({ ...h, supplierAddressText: ev.target.value })} />
            <div className="hint">From the supplier&apos;s default office or billing address.</div>
          </div>
          <div className="field full">
            <label htmlFor="notes">Notes</label>
            <textarea id="notes" rows={2} value={h.notes} onChange={(ev) => setH({ ...h, notes: ev.target.value })} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Items</h2>
          <div className="right">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setItems((xs) => [...xs, blank()])}>
              Add line
            </button>
          </div>
        </div>
        {itemErrors.length > 0 && (
          <div className="alert error" role="alert">
            {itemErrors.map(([k, m]) => {
              const n = Number(k.split(".")[1]);
              return <div key={k}>{Number.isFinite(n) ? `Line ${n + 1}: ${m}` : m}</div>;
            })}
          </div>
        )}
        <div className="edit-table items-edit">
          <table className="list">
            <thead>
              <tr>
                <th>Description</th>
                <th>Kind</th>
                <th className="num">Qty</th>
                <th>Unit</th>
                <th className="num">Unit cost</th>
                <th className="num">Total</th>
                <th aria-label="Line actions" />
              </tr>
            </thead>
            <tbody>
              {items.map((i, idx) => (
                <tr key={i.key}>
                  <td>
                    <textarea aria-label={`Line ${idx + 1} description`} rows={1} value={i.description} onChange={(ev) => setItem(i.key, { description: ev.target.value })} />
                    {i.linked && <div className="small faint">From the sales order</div>}
                  </td>
                  <td>
                    <select aria-label={`Line ${idx + 1} kind`} value={i.kind} onChange={(ev) => setItem(i.key, { kind: ev.target.value as ItemKind })}>
                      <option value="GOODS">Goods</option>
                      <option value="SERVICES">Services</option>
                    </select>
                  </td>
                  <td className="num">
                    <input aria-label={`Line ${idx + 1} qty`} inputMode="decimal" className="w-num-s" value={i.qty} onChange={(ev) => setItem(i.key, { qty: ev.target.value })} />
                  </td>
                  <td>
                    <input aria-label={`Line ${idx + 1} unit`} className="w-unit" value={i.unit} onChange={(ev) => setItem(i.key, { unit: ev.target.value })} />
                  </td>
                  <td className="num">
                    <input aria-label={`Line ${idx + 1} unit cost`} inputMode="decimal" className="w-num" value={i.unitCost} onChange={(ev) => setItem(i.key, { unitCost: ev.target.value })} />
                  </td>
                  <td className="num strong">{formatPeso(safeTotal(i))}</td>
                  <td className="line-actions">
                    <button type="button" className="btn-link danger" aria-label={`Remove line ${idx + 1}`} disabled={items.length === 1} onClick={() => setItems((xs) => xs.filter((x) => x.key !== i.key))}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="totals-wrap">
          <div className="totals-box" aria-label="Totals">
            <div className="totals-row strong">
              <span>PO total</span>
              <span className="num">{formatPeso(subtotal)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="form-actions">
        <button className="btn" type="submit" disabled={pending || !h.supplierId}>
          {pending ? "Saving…" : isNew ? "Create PO" : "Save changes"}
        </button>
        <a className="btn btn-secondary" href={cancelHref}>
          Cancel
        </a>
      </div>
    </form>
  );
}
