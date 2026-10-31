"use client";

import { useEffect, useState, useTransition } from "react";
import { WithholdingPickField } from "@/components/WithholdingPickField";
import type { WithholdingSnapshot } from "@/lib/quotes/calc";
import {
  WITHHOLDING_TYPE_FIELD_LABEL,
  WITHHOLDING_TYPE_FORM_LABELS,
  WITHHOLDING_TYPE_FORM_ORDER,
  withholdingTypeFieldHint,
} from "@/lib/withholding/display";
import { createCustomerFromQuoteAction } from "@/app/(app)/quotes/create-customer-action";
import type { EditorCustomer } from "./DocumentEditor";

export type AddCustomerDialogProps = {
  open: boolean;
  onClose: () => void;
  onSaved: (c: EditorCustomer) => void;
  rates: WithholdingSnapshot[];
};

export function AddCustomerDialog({ open, onClose, onSaved, rates }: AddCustomerDialogProps) {
  const [name, setName] = useState("");
  const [tin, setTin] = useState("");
  const [withholdingType, setWithholdingType] = useState("");
  const [pick, setPick] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setName("");
    setTin("");
    setWithholdingType("");
    setPick(null);
    setError(null);
    setFieldErrors({});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function save() {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await createCustomerFromQuoteAction({
        name,
        tin,
        withholdingType,
        defaultWithholding: pick,
      });
      if (!result.ok) {
        setError(result.message ?? "Could not save customer.");
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      onSaved(result.customer);
    });
  }

  const blocked = !name.trim() || !withholdingType;

  return (
    <div className="quote-drawer-root" role="dialog" aria-modal="true" aria-labelledby="add-customer-title">
      <button type="button" className="quote-drawer-backdrop" aria-label="Close" onClick={onClose} />
      <div className="quote-drawer">
        <div className="quote-drawer-head">
          <h2 id="add-customer-title">Add customer</h2>
          <button type="button" className="btn-link" onClick={onClose}>
            Close
          </button>
        </div>

        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}

        <div className="form-grid">
          <div className={`field full${fieldErrors.name ? " has-error" : ""}`}>
            <label htmlFor="add-customer-name">
              Name<span className="req"> *</span>
            </label>
            <input id="add-customer-name" type="text" value={name} onChange={(ev) => setName(ev.target.value)} autoFocus />
            {fieldErrors.name && <div className="error">{fieldErrors.name}</div>}
          </div>

          <div className={`field full${fieldErrors.withholdingType ? " has-error" : ""}`}>
            <label htmlFor="add-customer-type">
              {WITHHOLDING_TYPE_FIELD_LABEL}
              <span className="req"> *</span>
            </label>
            <select id="add-customer-type" value={withholdingType} onChange={(ev) => setWithholdingType(ev.target.value)}>
              <option value="">Pick one…</option>
              {WITHHOLDING_TYPE_FORM_ORDER.map((t) => (
                <option key={t} value={t}>
                  {WITHHOLDING_TYPE_FORM_LABELS[t]}
                </option>
              ))}
            </select>
            {fieldErrors.withholdingType ? (
              <div className="error">{fieldErrors.withholdingType}</div>
            ) : (
              <div className="hint">{withholdingTypeFieldHint(withholdingType) ?? "Label only — rates are picked below."}</div>
            )}
          </div>

          <div className="field full">
            <WithholdingPickField
              rates={rates}
              value={pick}
              onChange={setPick}
              disabled={pending}
              error={fieldErrors.defaultWithholding}
            />
          </div>

          <div className={`field full${fieldErrors.tin ? " has-error" : ""}`}>
            <label htmlFor="add-customer-tin">TIN</label>
            <input
              id="add-customer-tin"
              type="text"
              value={tin}
              onChange={(ev) => setTin(ev.target.value)}
              inputMode="numeric"
              placeholder="000-000-000-000"
            />
            {fieldErrors.tin ? <div className="error">{fieldErrors.tin}</div> : <div className="hint">Optional · 000-000-000-000</div>}
          </div>
        </div>

        <div className="quote-drawer-foot">
          {blocked && <span className="small faint">Name and type are required.</span>}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={save} disabled={pending || blocked}>
            {pending ? "Saving…" : "Save customer"}
          </button>
        </div>
      </div>
    </div>
  );
}
