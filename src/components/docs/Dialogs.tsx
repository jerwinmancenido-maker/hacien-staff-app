"use client";

// Modals for the document actions: void (reason required), convert to SO, email draft.

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { FormState } from "@/lib/validation/forms";

export function Modal({ title, children, onClose, labelId }: { title: string; children: ReactNode; onClose: () => void; labelId: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-labelledby={labelId} onClick={(e) => e.stopPropagation()}>
        <h3 id={labelId}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function VoidDialog({
  docLabel,
  body,
  onClose,
  onVoid,
}: {
  docLabel: string;
  body: string;
  onClose: () => void;
  onVoid: (reason: string) => Promise<FormState>;
}) {
  const [reason, setReason] = useState("");
  const [state, setState] = useState<FormState>({});
  const [pending, setPending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const error = state.fieldErrors?.reason ?? (!state.ok ? state.message : undefined);
  return (
    <Modal title={`Void this ${docLabel}?`} onClose={onClose} labelId="void-title">
      <p>{body}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          const res = await onVoid(reason);
          setPending(false);
          if (res.ok) onClose();
          else setState(res);
        }}
      >
        <div className={`field${error ? " has-error" : ""}`}>
          <label htmlFor="void-reason">
            Reason<span className="req"> *</span>
          </label>
          <textarea id="void-reason" ref={ref} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="buttons">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-danger solid" disabled={pending || reason.trim().length < 3}>
            {pending ? "Voiding…" : `Void ${docLabel}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** A saved customer address offered in the Convert dialog (text = formatted, multi-line). */
export type AddressOption = { id: string; label: string; text: string };

export function ConvertDialog({
  number,
  defaultAddress,
  addressOptions = [],
  onClose,
  onConvert,
}: {
  number: string;
  defaultAddress: string;
  addressOptions?: AddressOption[];
  onClose: () => void;
  onConvert: (input: { buyerPoNo: string; buyerPoDate: string; deliveryAddress: string }) => Promise<FormState>;
}) {
  const [v, setV] = useState({ buyerPoNo: "", buyerPoDate: "", deliveryAddress: defaultAddress });
  const picked = addressOptions.find((o) => o.text === v.deliveryAddress)?.id ?? "";
  const [state, setState] = useState<FormState>({});
  const [pending, setPending] = useState(false);
  const e = state.fieldErrors ?? {};
  return (
    <Modal title={`Convert ${number} to a sales order?`} onClose={onClose} labelId="convert-title">
      <p>The quote becomes Won and a new sales order is created with the same items, costs and withholding. You can fill in the buyer PO later.</p>
      <form
        onSubmit={async (ev) => {
          ev.preventDefault();
          setPending(true);
          const res = await onConvert(v);
          setPending(false);
          if (!res.ok) setState(res);
        }}
      >
        {state.message && !state.ok && (
          <div className="alert error" role="alert">
            {state.message}
          </div>
        )}
        <div className="form-grid">
          <div className={`field${e.buyerPoNo ? " has-error" : ""}`}>
            <label htmlFor="buyerPoNo">Buyer PO no.</label>
            <input id="buyerPoNo" type="text" value={v.buyerPoNo} onChange={(ev) => setV({ ...v, buyerPoNo: ev.target.value })} />
            {e.buyerPoNo && <div className="error">{e.buyerPoNo}</div>}
          </div>
          <div className={`field${e.buyerPoDate ? " has-error" : ""}`}>
            <label htmlFor="buyerPoDate">Buyer PO date</label>
            <input id="buyerPoDate" type="date" className="input" value={v.buyerPoDate} onChange={(ev) => setV({ ...v, buyerPoDate: ev.target.value })} />
            {e.buyerPoDate && <div className="error">{e.buyerPoDate}</div>}
          </div>
          {addressOptions.length > 0 && (
            <div className="field full">
              <label htmlFor="deliveryAddressPick">Saved address</label>
              <select
                id="deliveryAddressPick"
                value={picked}
                onChange={(ev) => {
                  const o = addressOptions.find((a) => a.id === ev.target.value);
                  if (o) setV({ ...v, deliveryAddress: o.text });
                }}
              >
                <option value="">Typed or edited address</option>
                {addressOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field full">
            <label htmlFor="deliveryAddress">Delivery address</label>
            <textarea id="deliveryAddress" rows={3} value={v.deliveryAddress} onChange={(ev) => setV({ ...v, deliveryAddress: ev.target.value })} />
            <div className="hint">Saved on the sales order as typed. Editing the customer&apos;s addresses later won&apos;t change it.</div>
          </div>
        </div>
        <div className="buttons">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={pending}>
            {pending ? "Converting…" : "Convert to SO"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export type EmailDraftView = { to: string | null; toName: string | null; subject: string; body: string };

export function EmailDialog({ draft, onClose }: { draft: EmailDraftView; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const mailto = `mailto:${draft.to ? encodeURIComponent(draft.to) : ""}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
  const copy = async () => {
    await navigator.clipboard.writeText(`To: ${draft.to ?? ""}\nSubject: ${draft.subject}\n\n${draft.body}`);
    setCopied(true);
  };
  return (
    <Modal title="Email draft" onClose={onClose} labelId="email-title">
      <p className="small muted">Nothing is sent from the app. Copy this into your email, or open it in your mail app, and attach the PDF.</p>
      <dl className="kv">
        <dt>To</dt>
        <dd>{draft.to ? `${draft.toName ? `${draft.toName} ` : ""}<${draft.to}>` : <span className="faint">No email on file for the contact</span>}</dd>
        <dt>Subject</dt>
        <dd>{draft.subject}</dd>
      </dl>
      <label htmlFor="email-body" className="sr-only">
        Body
      </label>
      <textarea id="email-body" className="input" readOnly rows={12} value={draft.body} style={{ width: "100%", marginTop: 10 }} />
      <div className="buttons">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
        <button type="button" className="btn btn-secondary" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
        <a className="btn" href={mailto}>
          Open in mail app
        </a>
      </div>
    </Modal>
  );
}
