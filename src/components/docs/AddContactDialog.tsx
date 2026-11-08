"use client";

// Right-side drawer: create a contact for the customer or supplier currently
// picked in an editor (quote, sales order, PO) without leaving the page.
// On save, the parent adds the contact to its list and selects it.

import { useEffect, useId, useRef, useState, useTransition } from "react";
import {
  createInlineContactAction,
  type CreateInlineContactState,
  type CreatedInlineContact,
} from "@/app/(app)/contacts/actions";
import type { ContactOwner } from "@/lib/services/contacts";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Who the new contact belongs to. */
  owner: ContactOwner;
  /** Shown in the drawer hint, e.g. the picked customer's name. */
  ownerName: string;
  /** Allowed roles from Settings → Lists. */
  roles: string[];
  onSaved: (contact: CreatedInlineContact) => void;
};

const empty = { name: "", role: "", email: "", phone: "", isMain: false };

export function AddContactDialog({ open, onClose, owner, ownerName, roles, onSaved }: Props) {
  const titleId = useId();
  const firstRef = useRef<HTMLInputElement>(null);
  const [formKey, setFormKey] = useState(0);
  const [v, setV] = useState(empty);
  const [state, setState] = useState<CreateInlineContactState>({});
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
    fd.set("name", v.name);
    fd.set("role", v.role);
    fd.set("email", v.email);
    fd.set("phone", v.phone);
    if (v.isMain) fd.set("isMain", "on");
    startTransition(async () => {
      const res = await createInlineContactAction(owner, {}, fd);
      setState(res);
      if (res.ok && res.contact) {
        onSaved(res.contact);
        onClose();
      }
    });
  }

  return (
    <div className="quote-drawer-root" role="presentation">
      <button type="button" className="quote-drawer-backdrop" aria-label="Close" disabled={pending} onClick={close} />
      <aside className="quote-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="quote-drawer-head">
          <h2 id={titleId}>Add contact</h2>
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
          <div className="hint">New contact for {ownerName}. It is selected in the editor when saved.</div>
          <div className={`field${e.name ? " has-error" : ""}`}>
            <label htmlFor="aci-name">
              Name<span className="req"> *</span>
            </label>
            <input
              ref={firstRef}
              id="aci-name"
              type="text"
              value={v.name}
              onChange={(ev) => setV({ ...v, name: ev.target.value })}
              autoComplete="name"
            />
            {e.name && <div className="error">{e.name}</div>}
          </div>
          <div className={`field${e.role ? " has-error" : ""}`}>
            <label htmlFor="aci-role">Role</label>
            <select id="aci-role" value={v.role} onChange={(ev) => setV({ ...v, role: ev.target.value })}>
              <option value="">No role</option>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            {e.role && <div className="error">{e.role}</div>}
          </div>
          <div className={`field${e.email ? " has-error" : ""}`}>
            <label htmlFor="aci-email">Email</label>
            <input id="aci-email" type="email" value={v.email} onChange={(ev) => setV({ ...v, email: ev.target.value })} autoComplete="email" />
            {e.email && <div className="error">{e.email}</div>}
          </div>
          <div className={`field${e.phone ? " has-error" : ""}`}>
            <label htmlFor="aci-phone">Phone</label>
            <input id="aci-phone" type="tel" value={v.phone} onChange={(ev) => setV({ ...v, phone: ev.target.value })} autoComplete="tel" />
            {e.phone && <div className="error">{e.phone}</div>}
          </div>
          <div className="field">
            <label className="checkbox">
              <input type="checkbox" checked={v.isMain} onChange={(ev) => setV({ ...v, isMain: ev.target.checked })} /> Main contact
            </label>
            <div className="hint">The first contact is made main automatically.</div>
          </div>
          <div className="quote-drawer-foot">
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Saving…" : "Save contact"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
