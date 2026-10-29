"use client";

import { useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import type { Customer } from "@prisma/client";
import { Field } from "@/components/Field";
import { WITHHOLDING_LABELS, WITHHOLDING_TYPES } from "@/lib/validation/companies";
import type { FormState } from "@/lib/validation/forms";

export function CustomerForm({
  customer,
  terms,
  action,
  canEdit,
}: {
  customer: Customer | null;
  terms: string[];
  action: (state: FormState, form: FormData) => Promise<FormState>;
  canEdit: boolean;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const v = (k: keyof Customer) => state.values?.[k] ?? (customer?.[k] as string | null) ?? "";
  const [name, setName] = useState(v("name"));
  const [withholding, setWithholding] = useState(v("withholdingType"));
  const e = state.fieldErrors ?? {};
  const termOptions = customer?.defaultTerms && !terms.includes(customer.defaultTerms) ? [...terms, customer.defaultTerms] : terms;
  const blocked = !name.trim() || !withholding;

  return (
    <form onSubmit={onSubmit} noValidate id="customer-form">
      {state.message && (
        <div className={`alert ${state.ok ? "ok" : "error"}`} role="status">
          {state.message}
        </div>
      )}
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-grid">
          <Field label="Name" name="name" required error={e.name} full>
            <input id="name" name="name" type="text" value={name} onChange={(ev) => setName(ev.target.value)} />
          </Field>
          <Field label="TIN" name="tin" error={e.tin} hint="000-000-000-000 · branch code optional">
            <input id="tin" name="tin" type="text" defaultValue={v("tin")} inputMode="numeric" placeholder="000-000-000-000" />
          </Field>
          <Field label="Withholding type" name="withholdingType" required error={e.withholdingType}>
            <select id="withholdingType" name="withholdingType" value={withholding} onChange={(ev) => setWithholding(ev.target.value)}>
              <option value="">Pick one…</option>
              {WITHHOLDING_TYPES.map((t) => (
                <option key={t} value={t}>
                  {WITHHOLDING_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Default terms" name="defaultTerms" error={e.defaultTerms}>
            <select id="defaultTerms" name="defaultTerms" defaultValue={v("defaultTerms")}>
              <option value="">None</option>
              {termOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Address" name="address" error={e.address} full>
            <textarea id="address" name="address" defaultValue={v("address")} rows={2} />
          </Field>
          <Field label="Notes" name="notes" error={e.notes} full>
            <textarea id="notes" name="notes" defaultValue={v("notes")} rows={3} />
          </Field>
        </div>
        {canEdit && (
          <div className="form-actions">
            <button className="btn" type="submit" disabled={pending || blocked}>
              {pending ? "Saving…" : "Save"}
            </button>
            {blocked && <span className="small faint">Name and withholding type are required.</span>}
          </div>
        )}
      </fieldset>
    </form>
  );
}
