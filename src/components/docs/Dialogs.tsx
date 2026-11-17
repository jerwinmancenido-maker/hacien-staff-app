"use client";

// Modals for the document actions: void (reason required), convert to SO, email draft.

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { FormState } from "@/lib/validation/forms";
import type { EditorAddressOption } from "./DocumentEditor";

export function Modal({
  title,
  children,
  onClose,
  labelId,
  variant,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  labelId: string;
  /** "drawer-right": slide-over panel pinned to the right edge (product details). Default: centered. */
  variant?: "drawer-right";
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className={variant === "drawer-right" ? "modal-backdrop drawer" : "modal-backdrop"} onClick={onClose}>
      <div
        className={variant === "drawer-right" ? "modal wide drawer-right" : "modal wide"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        onClick={(e) => e.stopPropagation()}
      >
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
          {state.values?.billHref && (
            <p className="small" style={{ marginTop: 8 }}>
              <a href={state.values.billHref}>Open {state.values.billLabel ?? "supplier bill"} →</a>
            </p>
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

/** Admin delete of a draft or void document. A typed reason is required. */
export function DeleteDialog({
  number,
  body,
  onClose,
  onDelete,
}: {
  number: string;
  body: string;
  onClose: () => void;
  onDelete: (reason: string) => Promise<FormState>;
}) {
  const [reason, setReason] = useState("");
  const [state, setState] = useState<FormState>({});
  const [pending, setPending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const error = state.fieldErrors?.reason ?? (!state.ok ? state.message : undefined);
  return (
    <Modal title={`Delete ${number}?`} onClose={onClose} labelId="delete-title">
      <p>{body}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          const res = await onDelete(reason);
          setPending(false);
          if (res.ok) onClose();
          else setState(res);
        }}
      >
        <div className={`field${error ? " has-error" : ""}`}>
          <label htmlFor="delete-reason">
            Reason<span className="req"> *</span>
          </label>
          <textarea id="delete-reason" ref={ref} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
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
            {pending ? "Deleting…" : "Delete"}
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
  hasAcceptance = false,
  customerName,
  onAddAddress,
  onClose,
  onConvert,
}: {
  number: string;
  defaultAddress: string;
  addressOptions?: AddressOption[];
  /** Audit: a conforme file is on file or acceptance is recorded. */
  hasAcceptance?: boolean;
  /** Customer display name for the add-address dialog title. */
  customerName?: string;
  /** Saves a new DELIVERY address to the customer; the dialog picks it at once. */
  onAddAddress?: (input: NewAddressFields) => Promise<FormState & { address?: EditorAddressOption }>;
  onClose: () => void;
  onConvert: (input: { buyerPoNo: string; buyerPoDate: string; deliveryAddressId: string; deliveryAddress?: string }) => Promise<FormState>;
}) {
  const initialPicked = addressOptions.find((o) => o.text === defaultAddress)?.id ?? addressOptions[0]?.id ?? "";
  const [v, setV] = useState({ buyerPoNo: "", buyerPoDate: "", deliveryAddressId: initialPicked });
  const [state, setState] = useState<FormState>({});
  const [pending, setPending] = useState(false);
  const [options, setOptions] = useState<AddressOption[]>(addressOptions);
  const [addOpen, setAddOpen] = useState(false);
  const e = state.fieldErrors ?? {};
  const selectedOption = options.find((o) => o.id === v.deliveryAddressId);
  const hasOptions = options.length > 0;

  return (
    <Modal title={`Convert ${number} to a sales order?`} onClose={onClose} labelId="convert-title">
      <p>The quote becomes Won and a new sales order is created with the same items, costs and withholding.</p>
      {!hasAcceptance && (
        <p className="faint">No customer acceptance on file yet — enter the buyer PO number below, or record acceptance on the Conforme tab first.</p>
      )}
      <form
        onSubmit={async (ev) => {
          ev.preventDefault();
          if (!v.deliveryAddressId) {
            setState({ message: "Pick a delivery address from the customer's saved addresses.", fieldErrors: { deliveryAddressId: "Pick a delivery address from the customer's saved addresses." } });
            return;
          }
          setPending(true);
          const res = await onConvert({
            ...v,
            deliveryAddress: selectedOption?.text ?? "",
          });
          setPending(false);
          if (!res.ok) setState(res);
        }}
      >
        {state.message && !state.ok && (
          <div className="alert error" role="alert">
            {state.message}
          </div>
        )}
        {!hasOptions && !onAddAddress && (
          <div className="alert error" role="alert">
            This customer has no saved addresses. Add an address to the customer before converting to a sales order.
          </div>
        )}
        {!hasOptions && onAddAddress && (
          <p className="faint">This customer has no saved addresses yet. Add one below — it is saved to the customer and used for this sales order.</p>
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
          <div className={`field full${e.deliveryAddressId ? " has-error" : ""}`}>
            <label htmlFor="deliveryAddressPick">
              Delivery address <span className="req">*</span>
            </label>
            <select
              id="deliveryAddressPick"
              value={v.deliveryAddressId}
              onChange={(ev) => setV({ ...v, deliveryAddressId: ev.target.value })}
              required
              disabled={!hasOptions}
            >
              <option value="">Pick a delivery address…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            {e.deliveryAddressId && <div className="error">{e.deliveryAddressId}</div>}
            {selectedOption && (
              <div className="hint" style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>
                {selectedOption.text}
              </div>
            )}
            <div className="hint">Saved on the sales order from the customer&apos;s address. Editing the customer&apos;s addresses later won&apos;t change it.</div>
            {onAddAddress && (
              <div style={{ marginTop: 8 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setAddOpen(true)}>
                  + Add new address
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="buttons">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={pending || !v.deliveryAddressId || !hasOptions}>
            {pending ? "Converting…" : "Convert to SO"}
          </button>
        </div>
      </form>
      {addOpen && onAddAddress && (
        <AddAddressDialog
          customerName={customerName ?? "Customer"}
          onClose={() => setAddOpen(false)}
          onSaved={(a) => {
            setOptions((prev) => [...prev, { id: a.id, label: a.label, text: a.text }]);
            setV((s) => ({ ...s, deliveryAddressId: a.id }));
            setState({});
            setAddOpen(false);
          }}
          action={onAddAddress}
          note="Saved to the customer as a Delivery address and picked for this sales order."
        />
      )}
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
export type NewAddressFields = { label: string; street: string; barangay: string; cityMunicipality: string; province: string; zip: string };

/**
 * "+ Add new address" in the delivery picker: saves a DELIVERY address to
 * the customer (same fields + validation as the customer profile) and hands
 * it back so the editor can pick it at once.
 */
export function AddAddressDialog({
  customerName,
  onClose,
  onSaved,
  action,
  note = "Saved to the customer as a Delivery address and picked on this quote.",
}: {
  customerName: string;
  onClose: () => void;
  onSaved: (a: EditorAddressOption) => void;
  action: (input: NewAddressFields) => Promise<FormState & { address?: EditorAddressOption }>;
  /** What happens to the address after saving; defaults to the quote-editor wording. */
  note?: string;
}) {
  const [fields, setFields] = useState<NewAddressFields>({ label: "", street: "", barangay: "", cityMunicipality: "", province: "", zip: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof NewAddressFields) => (ev: { target: { value: string } }) => setFields((f) => ({ ...f, [k]: ev.target.value }));

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await action(fields);
      if (res.address) {
        onSaved(res.address);
        return;
      }
      setErrors(res.fieldErrors ?? {});
      setMessage(res.message ?? "Could not add the address.");
    } finally {
      setBusy(false);
    }
  }

  const field = (k: keyof NewAddressFields, label: string, required: boolean, maxLength?: number) => (
    <div className={`field${errors[k] ? " has-error" : ""}`}>
      <label htmlFor={`qa-${k}`}>
        {label}
        {required && <span className="req"> *</span>}
      </label>
      <input id={`qa-${k}`} type="text" value={fields[k]} maxLength={maxLength} onChange={set(k)} />
      {errors[k] && <div className="error">{errors[k]}</div>}
    </div>
  );

  return (
    <Modal title={`Add delivery address — ${customerName}`} onClose={onClose} labelId="qa-title">
      <p className="small muted">{note}</p>
      {message && (
        <div className="alert error" role="alert">
          {message}
        </div>
      )}
      {field("label", "Label (e.g. Warehouse)", false, 100)}
      {field("street", "Unit / building / street", true, 500)}
      {field("barangay", "Barangay", true, 120)}
      {field("cityMunicipality", "City / municipality", true, 120)}
      {field("province", "Province", true, 120)}
      {field("zip", "ZIP code", true, 4)}
      <div className="buttons">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn" onClick={submit} disabled={busy}>
          {busy ? "Adding…" : "Add address"}
        </button>
      </div>
    </Modal>
  );
}