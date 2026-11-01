"use client";

// Right-side drawer: create a customer from the quote editor without leaving
// the page. On save, the parent picks the new customer and keeps quote data.

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { WithholdingPickField } from "@/components/WithholdingPickField";
import type { WithholdingSnapshot } from "@/lib/quotes/calc";
import { customerWithholdingHint } from "@/lib/quotes/customer-withholding-hint";
import { defaultWithholdingPickFor } from "@/lib/quotes/withholding-defaults";
import {
  WITHHOLDING_TYPE_FORM_LABELS,
  WITHHOLDING_TYPE_FORM_ORDER,
} from "@/lib/withholding/display";
import {
  createCustomerForQuoteAction,
  type CreatedQuoteCustomer,
  type CreateCustomerForQuoteState,
} from "@/app/(app)/quotes/create-customer-action";

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: (customer: CreatedQuoteCustomer) => void;
  /** Active Settings → Withholding rates for the pick field. */
  rates: WithholdingSnapshot[];
};

const empty = {
  name: "",
  tin: "",
  withholdingType: "",
  address: "",
  contactName: "",
  contactRole: "",
  emailOrPhone: "",
};

export function AddCustomerDialog({ open, onClose, onSaved, rates }: Props) {
  const titleId = useId();
  const firstRef = useRef<HTMLInputElement>(null);
  const [formKey, setFormKey] = useState(0);
  const [v, setV] = useState(empty);
  const [pick, setPick] = useState<string[] | null>(null);
  const [state, setState] = useState<CreateCustomerForQuoteState>({});
  const [pending, startTransition] = useTransition();
  const e = state.fieldErrors ?? {};
  const typeIsYes = v.withholdingType === "GOVERNMENT" || v.withholdingType === "TOP_WITHHOLDING_AGENT";
  const effectivePick = v.withholdingType === "NONE" ? [] : pick;
  const pickSnapshots =
    effectivePick == null ? null : rates.filter((r) => effectivePick.includes(r.code));
  const pickHint = customerWithholdingHint(pickSnapshots);

  function onTypeChange(next: string) {
    setV({ ...v, withholdingType: next });
    const suggested = defaultWithholdingPickFor(next);
    setPick(suggested == null ? null : [...suggested]);
  }

  function close() {
    if (pending) return;
    onClose();
    // Reset on next open via remount key (avoids setState-in-effect lint).
    setFormKey((k) => k + 1);
    setV(empty);
    setPick(null);
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
    // close is stable enough for escape; pending gates the handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [open, pending]);

  if (!open) return null;

  function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const fd = new FormData();
    for (const [k, val] of Object.entries(v)) fd.set(k, val);
    fd.set("defaultWithholdingJson", pick == null ? "" : JSON.stringify(pick));
    startTransition(async () => {
      const res = await createCustomerForQuoteAction({}, fd);
      setState(res);
      if (res.ok && res.customer) {
        onSaved(res.customer);
        onClose();
      }
    });
  }

  return (
    <div className="quote-drawer-root" role="presentation">
      <button type="button" className="quote-drawer-backdrop" aria-label="Close" disabled={pending} onClick={close} />
      <aside className="quote-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="quote-drawer-head">
          <h2 id={titleId}>Add new customer</h2>
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
            <label htmlFor="acq-name">
              Customer name<span className="req"> *</span>
            </label>
            <input
              ref={firstRef}
              id="acq-name"
              type="text"
              value={v.name}
              onChange={(ev) => setV({ ...v, name: ev.target.value })}
              autoComplete="organization"
            />
            {e.name && <div className="error">{e.name}</div>}
          </div>
          <div className="quote-drawer-row quote-drawer-tin-type">
            <div className={`field${e.tin ? " has-error" : ""}`}>
              <label htmlFor="acq-tin">TIN</label>
              <input
                id="acq-tin"
                type="text"
                value={v.tin}
                onChange={(ev) => setV({ ...v, tin: ev.target.value })}
                inputMode="numeric"
                placeholder="000-000-000-000"
              />
              {e.tin && <div className="error">{e.tin}</div>}
            </div>
            <div className={`field${e.withholdingType ? " has-error" : ""}`}>
              <label htmlFor="acq-type">
                Type<span className="req"> *</span>
              </label>
              <select id="acq-type" value={v.withholdingType} onChange={(ev) => onTypeChange(ev.target.value)}>
                <option value="">Pick one…</option>
                {WITHHOLDING_TYPE_FORM_ORDER.map((t) => (
                  <option key={t} value={t}>
                    {t === "NONE" ? "Private" : WITHHOLDING_TYPE_FORM_LABELS[t]}
                  </option>
                ))}
              </select>
              <div className="hint">
                {v.withholdingType === "NONE"
                  ? "No withholding — rates are saved as none."
                  : "Label only — rates are picked in Withholding below."}
              </div>
              {e.withholdingType && <div className="error">{e.withholdingType}</div>}
            </div>
          </div>
          {typeIsYes ? (
            <>
              <WithholdingPickField
                rates={rates}
                value={pick}
                onChange={setPick}
                disabled={pending}
                error={e.defaultWithholding}
              />
              <div className="hint">{pickHint}</div>
            </>
          ) : (
            <input type="hidden" name="defaultWithholdingJson" value={v.withholdingType === "NONE" ? "[]" : ""} />
          )}
          <div className={`field${e.address ? " has-error" : ""}`}>
            <label htmlFor="acq-address">Address</label>
            <textarea id="acq-address" rows={2} value={v.address} onChange={(ev) => setV({ ...v, address: ev.target.value })} />
          </div>
          <div className="quote-drawer-row">
            <div className={`field${e.contactName ? " has-error" : ""}`}>
              <label htmlFor="acq-contact">Contact person</label>
              <input
                id="acq-contact"
                type="text"
                value={v.contactName}
                onChange={(ev) => setV({ ...v, contactName: ev.target.value })}
              />
              {e.contactName && <div className="error">{e.contactName}</div>}
            </div>
            <div className={`field${e.contactRole ? " has-error" : ""}`}>
              <label htmlFor="acq-role">Position</label>
              <input
                id="acq-role"
                type="text"
                value={v.contactRole}
                onChange={(ev) => setV({ ...v, contactRole: ev.target.value })}
              />
            </div>
          </div>
          <div className={`field${e.emailOrPhone ? " has-error" : ""}`}>
            <label htmlFor="acq-email">Email or phone</label>
            <input
              id="acq-email"
              type="text"
              value={v.emailOrPhone}
              onChange={(ev) => setV({ ...v, emailOrPhone: ev.target.value })}
            />
            {e.emailOrPhone && <div className="error">{e.emailOrPhone}</div>}
          </div>
          <div className="quote-drawer-foot">
            <span className="muted small">Saves and picks this customer</span>
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn" disabled={pending || !v.name.trim() || !v.withholdingType}>
              {pending ? "Saving…" : "Save customer"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
