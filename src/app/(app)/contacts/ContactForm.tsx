"use client";

import { useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import type { Contact } from "@prisma/client";
import { Field } from "@/components/Field";
import type { FormState } from "@/lib/validation/forms";

export function ContactForm({
  contact,
  roles,
  action,
  canEdit,
  firstContact,
}: {
  contact: Contact | null;
  roles: string[];
  action: (state: FormState, form: FormData) => Promise<FormState>;
  canEdit: boolean;
  /** The company has no active main contact yet, so this one will become main. */
  firstContact?: boolean;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const v = (k: keyof Contact) => state.values?.[k] ?? (contact?.[k] as string | null) ?? "";
  const [name, setName] = useState(v("name"));
  const [email, setEmail] = useState(v("email"));
  const [phone, setPhone] = useState(v("phone"));
  const e = state.fieldErrors ?? {};
  const roleOptions = contact?.role && !roles.includes(contact.role) ? [...roles, contact.role] : roles;
  const isMain = !!contact?.isMain;
  const blockedReason = !name.trim() ? "Name is required." : !email.trim() && !phone.trim() ? "Add an email or a phone number." : null;

  return (
    <form onSubmit={onSubmit} noValidate>
      {state.message && (
        <div className={`alert ${state.ok ? "ok" : "error"}`} role="status">
          {state.message}
        </div>
      )}
      <fieldset disabled={!canEdit || (contact ? !contact.active : false)} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-grid">
          <Field label="Name" name="name" required error={e.name}>
            <input id="name" name="name" type="text" value={name} onChange={(ev) => setName(ev.target.value)} />
          </Field>
          <Field label="Role" name="role" error={e.role}>
            <select id="role" name="role" defaultValue={v("role")}>
              <option value="">—</option>
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Email" name="email" error={e.email}>
            <input id="email" name="email" type="email" value={email} onChange={(ev) => setEmail(ev.target.value)} />
          </Field>
          <Field label="Phone" name="phone" error={e.phone}>
            <input id="phone" name="phone" type="text" inputMode="tel" value={phone} onChange={(ev) => setPhone(ev.target.value)} />
          </Field>
          <div className="field full">
            {isMain ? (
              <>
                <input type="hidden" name="isMain" value="on" />
                <span className="check">
                  <input type="checkbox" checked disabled aria-label="Main contact" /> Main contact
                </span>
                <div className="hint">To change the main contact, open another contact and choose Make main.</div>
              </>
            ) : firstContact ? (
              <>
                <input type="hidden" name="isMain" value="on" />
                <span className="check">
                  <input type="checkbox" checked disabled aria-label="Main contact" /> Main contact
                </span>
                <div className="hint">The first contact becomes the main contact.</div>
              </>
            ) : (
              <label className="check" htmlFor="isMain">
                <input id="isMain" name="isMain" type="checkbox" defaultChecked={state.values?.isMain === "on"} /> Main contact
                <span className="faint small">(the old main stays as a normal contact)</span>
              </label>
            )}
          </div>
        </div>
        {canEdit && (!contact || contact.active) && (
          <div className="form-actions">
            <button className="btn" type="submit" disabled={pending || !!blockedReason}>
              {pending ? "Saving…" : "Save"}
            </button>
            {blockedReason && <span className="small faint">{blockedReason}</span>}
          </div>
        )}
      </fieldset>
    </form>
  );
}
