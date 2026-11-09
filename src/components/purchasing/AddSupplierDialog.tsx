"use client";

// Right-side drawer: create a supplier from the PO editor without leaving
// the page. On save, the parent adds the supplier to its list and selects
// it. Bank details are not collected here — they live on the supplier
// record (Admin-only there).

import { useEffect, useId, useRef, useState, useTransition } from "react";
import {
  createInlineSupplierAction,
  type CreateInlineSupplierState,
  type CreatedInlineSupplier,
} from "@/app/(app)/suppliers/actions";
import { SUPPLIER_TAX_TYPES, TAX_TYPE_LABELS } from "@/lib/validation/companies";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Allowed payment terms list from Settings. */
  termsOptions: string[];
  onSaved: (supplier: CreatedInlineSupplier) => void;
};

const empty = { name: "", tin: "", taxType: "NON_VAT", defaultTerms: "", contactName: "", contactEmail: "", contactPhone: "" };

export function AddSupplierDialog({ open, onClose, termsOptions, onSaved }: Props) {
  const titleId = useId();
  const firstRef = useRef<HTMLInputElement>(null);
  const [formKey, setFormKey] = useState(0);
  const [v, setV] = useState(empty);
  const [state, setState] = useState<CreateInlineSupplierState>({});
  const [pending, startTransition] = useTransition();
  const e = state.fieldErrors ?? {};

  function close() {
    if (pending) return;
    onClose();
    // Reset on next open via remount key (avoids setState-in-effect lint).
    setFormKey((k) => k + 1);
    setV(empty);
    setState({});
  }

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => firstRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, [open, formKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && !pending) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [open, pending]);

  if (!open) return null;

  function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const fd = new FormData();
    for (const [k, val] of Object.entries(v)) fd.set(k, val);
    startTransition(async () => {
      const res = await createInlineSupplierAction({}, fd);
      setState(res);
      if (res.ok && res.supplier) {
        onSaved(res.supplier);
        onClose();
      }
    });
  }

  return (
    <div className="quote-drawer-root" role="presentation">
      <button type="button" className="quote-drawer-backdrop" aria-label="Close" disabled={pending} onClick={close} />
      <aside className="quote-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="quote-drawer-head">
          <h2 id={titleId}>Add supplier</h2>
          <button type="button" className="btn-link quote-drawer-x" aria-label="Close" disabled={pending} onClick={close}>
            ×
          </button>
        </div>
        <form key={formKey} className="quote-drawer-body" onSubmit={submit} noValidate>
          {state.message && !state.ok && (
            <div className="alert error" role="alert">
              {state.message}
            </div>
          )}
          <div className={`field${e.name ? " has-error" : ""}`}>
            <label htmlFor="asd-name">
              Supplier name<span className="req"> *</span>
            </label>
            <input ref={firstRef} id="asd-name" type="text" value={v.name} onChange={(ev) => setV({ ...v, name: ev.target.value })} autoComplete="organization" />
            {e.name && <div className="error">{e.name}</div>}
          </div>
          <div className={`field${e.taxType ? " has-error" : ""}`}>
            <label htmlFor="asd-taxType">
              Tax type<span className="req"> *</span>
            </label>
            <select id="asd-taxType" value={v.taxType} onChange={(ev) => setV({ ...v, taxType: ev.target.value })}>
              {SUPPLIER_TAX_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TAX_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            {e.taxType && <div className="error">{e.taxType}</div>}
          </div>
          <div className={`field${e.tin ? " has-error" : ""}`}>
            <label htmlFor="asd-tin">TIN</label>
            <input id="asd-tin" type="text" value={v.tin} onChange={(ev) => setV({ ...v, tin: ev.target.value })} />
            {e.tin && <div className="error">{e.tin}</div>}
          </div>
          <div className={`field${e.defaultTerms ? " has-error" : ""}`}>
            <label htmlFor="asd-terms">Default terms</label>
            <select id="asd-terms" value={v.defaultTerms} onChange={(ev) => setV({ ...v, defaultTerms: ev.target.value })}>
              <option value="">None</option>
              {termsOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {e.defaultTerms && <div className="error">{e.defaultTerms}</div>}
          </div>
          <div style={{ fontWeight: 600, marginTop: 10 }}>First contact (optional)</div>
          <div className={`field${e.contactName ? " has-error" : ""}`}>
            <label htmlFor="asd-contactName">Contact name</label>
            <input id="asd-contactName" type="text" value={v.contactName} onChange={(ev) => setV({ ...v, contactName: ev.target.value })} autoComplete="name" />
            {e.contactName && <div className="error">{e.contactName}</div>}
          </div>
          <div className={`field${e.contactEmail ? " has-error" : ""}`}>
            <label htmlFor="asd-contactEmail">Contact email</label>
            <input id="asd-contactEmail" type="email" value={v.contactEmail} onChange={(ev) => setV({ ...v, contactEmail: ev.target.value })} autoComplete="email" />
            {e.contactEmail && <div className="error">{e.contactEmail}</div>}
          </div>
          <div className={`field${e.contactPhone ? " has-error" : ""}`}>
            <label htmlFor="asd-contactPhone">Contact phone</label>
            <input id="asd-contactPhone" type="tel" value={v.contactPhone} onChange={(ev) => setV({ ...v, contactPhone: ev.target.value })} autoComplete="tel" />
            {e.contactPhone && <div className="error">{e.contactPhone}</div>}
          </div>
          <div className="hint">Bank details are added later on the supplier record, before paying.</div>
          <div className="quote-drawer-foot">
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Saving…" : "Save supplier"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
