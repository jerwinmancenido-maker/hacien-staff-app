"use client";

// PO editor (standalone new PO, or editing a Draft/Approved PO). Totals here are
// a preview; the server recomputes and stores them on save. Lines that came
// from a sales order keep their link when edited.

import { useLayoutEffect, useRef, useState } from "react";
import { AddContactDialog } from "@/components/docs/AddContactDialog";
import { SearchPicker } from "@/components/SearchPicker";
import { AddSupplierDialog } from "./AddSupplierDialog";
import { useFormAction } from "@/components/useFormAction";
import { formatMoneyInput, formatPeso } from "@/lib/format";
import { fromScaled, lineAmounts, toScaled, type ItemKind } from "@/lib/quotes/calc";
import { overOrder, type SoPickerRow } from "@/lib/purchasing/picker";
import type { FormState } from "@/lib/validation/forms";

export type PoEditorSupplier = { id: string; name: string; defaultTerms: string | null; address: string | null; contacts: { id: string; name: string; isMain: boolean }[] };

export type PoEditorItem = {
  id: string | null;
  description: string;
  kind: ItemKind;
  qty: string;
  unit: string;
  unitCost: string;
  linked?: boolean;
  /** Part B: the SO link this line was created with (set by the picker). */
  salesOrderItemId?: string | null;
  salesOrderItemComponentId?: string | null;
  /** Qty still unordered on the SO when the line was picked (warning only). */
  remainingQty?: string | null;
  /** The SO line's own qty / unit cost, for the "Changed vs SO" marker. */
  soQty?: string | null;
  soUnitCost?: string | null;
};

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

/** Grow a line description textarea to fit its content — no clipped spec
 * lines (mirrors the quote editor's DescTextarea pattern). */
function growDesc(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "0px";
  el.style.height = `${Math.max(el.scrollHeight + 2, 36)}px`;
}

function PoDescTextarea({ label, value, onValue }: { label: string; value: string; onValue: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    growDesc(ref.current);
  }, [value]);
  return (
    <textarea
      ref={ref}
      aria-label={label}
      className="po-desc"
      rows={1}
      value={value}
      onChange={(ev) => {
        onValue(ev.target.value);
        growDesc(ev.target);
      }}
    />
  );
}
/** Auto-growing plain textarea (header fields): same growDesc mechanics as
 * the line descriptions — staging QA 2026-11-11 found Notes sat at a fixed
 * height with a scrollbar while line descriptions grew. */
function GrowTextarea({ id, rows, value, onValue }: { id: string; rows: number; value: string; onValue: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    growDesc(ref.current);
  }, [value]);
  return (
    <textarea
      id={id}
      ref={ref}
      rows={rows}
      value={value}
      onChange={(ev) => {
        onValue(ev.target.value);
        growDesc(ev.target);
      }}
    />
  );
}

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
  contactRoles,
  status,
  action,
  cancelHref,
  soPicker,
}: {
  isNew: boolean;
  initial: PoEditorInitial;
  suppliers: PoEditorSupplier[];
  termsOptions: string[];
  /** Allowed contact roles from Settings → Lists (for the inline Add contact drawer). */
  contactRoles: string[];
  status?: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  cancelHref: string;
  /** Part B: "Add from sales order" rows (edit page of an SO-born PO only). */
  soPicker?: { soNumber: string; rows: SoPickerRow[] } | null;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const [h, setH] = useState(() => ({ ...initial }));
  const [items, setItems] = useState<Row[]>(() => (initial.items.length ? initial.items.map((i) => ({ ...i, key: newKey() })) : [blank()]));
  const [supplierList, setSupplierList] = useState(suppliers);
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [addSupplierOpen, setAddSupplierOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQty, setPickerQty] = useState<Record<string, string>>({});
  const [pickerCost, setPickerCost] = useState<Record<string, string>>({});

  /** Add one picker row as a linked PO line. A zero cost needs a confirm
   * (audit B5); going past the remaining qty only warns (settled rule). */
  function addFromPicker(row: SoPickerRow) {
    const qty = pickerQty[row.key] ?? row.remainingQty;
    const unitCost = pickerCost[row.key] ?? row.unitCost;
    if (!Number((unitCost || "0").replace(/,/g, ""))) {
      const first = row.description.split("\n")[0];
      if (!window.confirm(`"${first}" has no cost yet. Add it at ₱0.00? You can set the cost on the line after.`)) return;
    }
    const picked: Row = {
      key: newKey(),
      id: null,
      description: row.description,
      kind: row.kind,
      qty,
      unit: row.unit,
      unitCost,
      linked: true,
      salesOrderItemId: row.isComponent ? null : row.key,
      salesOrderItemComponentId: row.isComponent ? row.key : null,
      remainingQty: row.remainingQty,
      soQty: row.soQty,
      soUnitCost: row.unitCost,
    };
    setItems((xs) => {
      // A single untouched blank row gives way to the picked line.
      const onlyBlank = xs.length === 1 && !xs[0]!.id && !xs[0]!.description.trim() && !xs[0]!.salesOrderItemId && !xs[0]!.salesOrderItemComponentId;
      return onlyBlank ? [picked] : [...xs, picked];
    });
  }

  const pickerRows = (soPicker?.rows ?? []).filter(
    (r) => !items.some((i) => (i.salesOrderItemComponentId ?? i.salesOrderItemId) === r.key),
  );
  const e = state.fieldErrors ?? {};
  const supplier = supplierList.find((s) => s.id === h.supplierId);
  const terms = h.terms && !termsOptions.includes(h.terms) ? [...termsOptions, h.terms] : termsOptions;
  const subtotal = fromScaled(
    items.reduce((acc, i) => acc + toScaled(safeTotal(i), 2), 0n),
    2,
  );
  const setItem = (key: string, patch: Partial<Row>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  function pickSupplier(id: string) {
    const s = supplierList.find((x) => x.id === id);
    setH((v) => ({
      ...v,
      supplierId: id,
      supplierContactId: s?.contacts.find((c) => c.isMain)?.id ?? "",
      terms: s?.defaultTerms ?? v.terms,
      supplierAddressText: s?.address ?? "",
    }));
  }

  /** A just-saved contact joins the picked supplier's list and is selected.
   * If it became the main contact, the local main flags follow the server. */
  function onContactAdded(c: { id: string; name: string; isMain: boolean }) {
    setSupplierList((xs) =>
      xs.map((x) =>
        x.id === h.supplierId
          ? { ...x, contacts: [...x.contacts.map((k) => (c.isMain ? { ...k, isMain: false } : k)), c] }
          : x,
      ),
    );
    setH((v) => ({ ...v, supplierContactId: c.id }));
  }

  /** A just-saved supplier joins the list and is picked, with the same
   * defaults pickSupplier would apply (main contact, terms, address). */
  function onSupplierAdded(s: PoEditorSupplier) {
    setSupplierList((xs) => (xs.some((x) => x.id === s.id) ? xs : [...xs, s].sort((a, b) => a.name.localeCompare(b.name))));
    setH((v) => ({
      ...v,
      supplierId: s.id,
      supplierContactId: s.contacts.find((c) => c.isMain)?.id ?? "",
      terms: s.defaultTerms ?? v.terms,
      supplierAddressText: s.address ?? "",
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
    items: items.map((i) => ({
      id: i.id,
      description: i.description,
      kind: i.kind,
      qty: i.qty,
      unit: i.unit,
      unitCost: i.unitCost,
      salesOrderItemId: i.salesOrderItemId ?? null,
      salesOrderItemComponentId: i.salesOrderItemComponentId ?? null,
    })),
  };
  const itemErrors = Object.entries(e).filter(([k]) => k.startsWith("items"));

  return (
    <>
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
      <div className="edit-topbar">
        <button className="btn" type="submit" disabled={pending || !h.supplierId}>
          {pending ? "Saving…" : isNew ? "Create PO" : "Save changes"}
        </button>
        <a className="btn btn-secondary" href={cancelHref}>
          Cancel
        </a>
      </div>
      <div className="card">
        <h2>PO details</h2>
        <div className="form-grid">
          {isNew ? (
            <div className={`field${e.supplierId ? " has-error" : ""}`}>
              <label htmlFor="supplierId">
                Supplier<span className="req"> *</span>
              </label>
              <SearchPicker
                id="supplierId"
                ariaLabel="Supplier"
                value={h.supplierId}
                options={supplierList.map((s) => ({ id: s.id, label: s.name }))}
                placeholder="Pick a supplier…"
                onPick={pickSupplier}
                addLabel="Add supplier"
                onAdd={() => setAddSupplierOpen(true)}
              />
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
            <SearchPicker
              id="supplierContactId"
              ariaLabel="Supplier contact"
              value={h.supplierContactId}
              options={(supplier?.contacts ?? []).map((c) => ({ id: c.id, label: c.name, meta: c.isMain ? "Main contact" : undefined }))}
              placeholder="Pick a contact…"
              emptyOptionLabel="None"
              disabled={!supplier}
              onPick={(id) => setH({ ...h, supplierContactId: id })}
              addLabel="Add contact"
              onAdd={() => setAddContactOpen(true)}
            />
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
            <GrowTextarea id="deliveryAddressText" rows={3} value={h.deliveryAddressText} onValue={(v) => setH({ ...h, deliveryAddressText: v })} />
            <div className="hint">Saved on the PO as typed.</div>
          </div>
          <div className="field full">
            <label htmlFor="supplierAddressText">Supplier address (on the PO)</label>
            <GrowTextarea id="supplierAddressText" rows={3} value={h.supplierAddressText} onValue={(v) => setH({ ...h, supplierAddressText: v })} />
            <div className="hint">From the supplier&apos;s default office or billing address.</div>
          </div>
          <div className="field full">
            <label htmlFor="notes">Notes</label>
            <GrowTextarea id="notes" rows={2} value={h.notes} onValue={(v) => setH({ ...h, notes: v })} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Items</h2>
          <div className="right">
            {soPicker && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPickerOpen((v) => !v)} aria-expanded={pickerOpen}>
                Add from sales order
              </button>
            )}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setItems((xs) => [...xs, blank()])}>
              Add line
            </button>
          </div>
        </div>
        {pickerOpen && soPicker && (
          <div className="so-picker">
            <div className="small faint" style={{ marginBottom: 8 }}>
              From {soPicker.soNumber}. Lines that can still be ordered for this supplier — quantity starts at what is left.
              Ordering more than what is left is allowed; it is saved as an extra and recorded.
            </div>
            {pickerRows.length === 0 ? (
              <div className="small">Nothing left to add from this sales order.</div>
            ) : (
              pickerRows.map((row) => {
                const qty = pickerQty[row.key] ?? row.remainingQty;
                const cost = pickerCost[row.key] ?? row.unitCost;
                const greyed = row.state === "other-supplier";
                return (
                  <div key={row.key} className={`so-picker-row${greyed ? " is-greyed" : ""}`}>
                    <div className="so-picker-main">
                      <div>{row.description.split("\n")[0]}</div>
                      <div className="small faint">
                        {row.parentDescription && <>Part of: {row.parentDescription.split("\n")[0]} · </>}
                        On the order: {row.soQty} {row.unit} · Already ordered: {row.orderedQty} · Left: {row.remainingQty}
                      </div>
                      {row.state === "no-supplier" && <div className="small">No supplier on the order. Will be bought from {supplier?.name ?? "this PO's supplier"}.</div>}
                      {greyed && <div className="small">Belongs to {row.supplierName} — it needs its own purchase order.</div>}
                      {!greyed && overOrder(qty, row.remainingQty) && <div className="small warn-text">More than what is left — saved as an extra.</div>}
                    </div>
                    {!greyed && (
                      <div className="so-picker-controls">
                        <label className="small faint">
                          Qty
                          <input aria-label={`Qty for ${row.description.split("\n")[0]}`} inputMode="decimal" className="w-num-s" value={qty} onChange={(ev) => setPickerQty((m) => ({ ...m, [row.key]: ev.target.value }))} />
                        </label>
                        <label className="small faint">
                          Unit cost
                          <input aria-label={`Unit cost for ${row.description.split("\n")[0]}`} inputMode="decimal" className="w-num" value={cost} onChange={(ev) => setPickerCost((m) => ({ ...m, [row.key]: formatMoneyInput(ev.target.value) }))} />
                        </label>
                        <button type="button" className="btn btn-sm" onClick={() => addFromPicker(row)}>
                          Add
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
        {itemErrors.length > 0 && (
          <div className="alert error" role="alert">
            {itemErrors.map(([k, m]) => {
              const n = Number(k.split(".")[1]);
              return <div key={k}>{Number.isFinite(n) ? `Line ${n + 1}: ${m}` : m}</div>;
            })}
          </div>
        )}
        <div className="edit-table items-edit po-items-edit">
          <table className="list">
            <thead>
              <tr>
                <th>Description</th>
                <th className="col-kind">Kind</th>
                <th className="num col-qty">Qty</th>
                <th className="col-unit">Unit</th>
                <th className="num col-money">Unit cost</th>
                <th className="num col-money">Total</th>
                <th className="col-actions" aria-label="Line actions" />
              </tr>
            </thead>
            <tbody>
              {items.map((i, idx) => (
                <tr key={i.key}>
                  <td>
                    <PoDescTextarea label={`Line ${idx + 1} description`} value={i.description} onValue={(v) => setItem(i.key, { description: v })} />
                    {i.linked && <div className="small faint">From the sales order</div>}
                    {i.linked && i.soQty != null && (toScaled(i.qty || "0", 2) !== toScaled(i.soQty, 2) || toScaled((i.unitCost || "0").replace(/,/g, ""), 2) !== toScaled(i.soUnitCost ?? "0", 2)) && (
                      <div className="small faint">Changed vs sales order — SO: {i.soQty} × {formatPeso(i.soUnitCost ?? "0")}</div>
                    )}
                    {i.linked && i.remainingQty != null && overOrder(i.qty, i.remainingQty) && (
                      <div className="small warn-text">More than what is left on the sales order ({i.remainingQty} left) — saved as an extra.</div>
                    )}
                  </td>
                  <td className="col-kind">
                    <select aria-label={`Line ${idx + 1} kind`} value={i.kind} onChange={(ev) => setItem(i.key, { kind: ev.target.value as ItemKind })}>
                      <option value="GOODS">Goods</option>
                      <option value="SERVICES">Services</option>
                    </select>
                  </td>
                  <td className="num col-qty">
                    <input aria-label={`Line ${idx + 1} qty`} inputMode="decimal" className="w-num-s" value={i.qty} onChange={(ev) => setItem(i.key, { qty: ev.target.value })} />
                  </td>
                  <td className="col-unit">
                    <input aria-label={`Line ${idx + 1} unit`} className="w-unit" value={i.unit} onChange={(ev) => setItem(i.key, { unit: ev.target.value })} />
                  </td>
                  <td className="num col-money">
                    <input aria-label={`Line ${idx + 1} unit cost`} inputMode="decimal" className="w-num" value={i.unitCost} onChange={(ev) => setItem(i.key, { unitCost: formatMoneyInput(ev.target.value) })} />
                  </td>
                  <td className="num col-money strong">{formatPeso(safeTotal(i))}</td>
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
        <div style={{ marginTop: 10 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setItems((xs) => [...xs, blank()])}>
            Add line
          </button>
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

    </form>
    {addContactOpen && supplier && (
      <AddContactDialog
        open={addContactOpen}
        onClose={() => setAddContactOpen(false)}
        owner={{ kind: "supplier", id: supplier.id }}
        ownerName={supplier.name}
        roles={contactRoles}
        onSaved={onContactAdded}
      />
    )}
    {addSupplierOpen && (
      <AddSupplierDialog open={addSupplierOpen} onClose={() => setAddSupplierOpen(false)} termsOptions={termsOptions} onSaved={onSupplierAdded} />
    )}
    </>
  );
}
