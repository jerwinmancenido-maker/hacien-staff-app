"use client";

import { useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import type { Customer } from "@prisma/client";
import { Field } from "@/components/Field";
import { WithholdingPickField } from "@/components/WithholdingPickField";
import type { WithholdingSnapshot } from "@/lib/quotes/calc";
import { parseWithholdingPick } from "@/lib/quotes/withholding-defaults";
import {
  WITHHOLDING_TYPE_FIELD_LABEL,
  WITHHOLDING_TYPE_FORM_LABELS,
  WITHHOLDING_TYPE_FORM_ORDER,
  withholdingTypeFieldHint,
} from "@/lib/withholding/display";
import type { FormState } from "@/lib/validation/forms";

function typeIsYes(type: string): boolean {
  return type === "GOVERNMENT" || type === "TOP_WITHHOLDING_AGENT";
}

export function CustomerForm({
  customer,
  terms,
  rates,
  action,
  canEdit,
  canEditWithholding = true,
}: {
  customer: Customer | null;
  terms: string[];
  /** Active Settings → Withholding rates staff may tick. */
  rates: WithholdingSnapshot[];
  action: (state: FormState, form: FormData) => Promise<FormState>;
  canEdit: boolean;
  /** Existing customers: only Admin may change withholding type/rates. */
  canEditWithholding?: boolean;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const v = (k: keyof Customer) => state.values?.[k] ?? (customer?.[k] as string | null) ?? "";
  const [name, setName] = useState(v("name"));
  const [withholding, setWithholding] = useState(v("withholdingType"));
  const initialPick =
    state.values?.defaultWithholding !== undefined
      ? parseWithholdingPick(state.values.defaultWithholding)
      : parseWithholdingPick(customer?.defaultWithholding);
  const [pick, setPick] = useState<string[] | null>(() => {
    // "No" always means explicit none [].
    if (v("withholdingType") === "NONE") return [];
    return initialPick;
  });
  const e = state.fieldErrors ?? {};
  const termOptions = customer?.defaultTerms && !terms.includes(customer.defaultTerms) ? [...terms, customer.defaultTerms] : terms;
  // Blank withholding (type unset, or Yes with rates still null) blocks save — never silent "No".
  const withholdingBlank = !withholding || (typeIsYes(withholding) && pick == null);
  const blocked = !name.trim() || withholdingBlank;
  const showPick = typeIsYes(withholding);
  const withholdingLocked = !canEditWithholding;

  function onTypeChange(next: string) {
    setWithholding(next);
    if (next === "NONE") setPick([]);
    else if (!typeIsYes(next)) setPick(null);
    else if (pick != null && pick.length === 0) setPick(null);
  }

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
          <Field
            label={WITHHOLDING_TYPE_FIELD_LABEL}
            name="withholdingType"
            required
            error={e.withholdingType}
            hint={
              showPick
                ? (withholdingTypeFieldHint(withholding) ?? "Label only — rates are picked in Withholding below.")
                : withholding === "NONE"
                  ? "No withholding — rates are saved as none."
                  : "Label only — rates are picked in Withholding below."
            }
            full
          >
            <select
              id="withholdingType"
              name="withholdingType"
              value={withholding}
              onChange={(ev) => onTypeChange(ev.target.value)}
              disabled={withholdingLocked}
            >
              <option value="">Pick one…</option>
              {WITHHOLDING_TYPE_FORM_ORDER.map((t) => (
                <option key={t} value={t}>
                  {WITHHOLDING_TYPE_FORM_LABELS[t]}
                </option>
              ))}
            </select>
            {withholdingLocked ? <div className="hint">Only an Admin can change withholding on an existing customer.</div> : null}
          </Field>
          {showPick ? (
            <div className="field full">
              <WithholdingPickField
                rates={rates}
                value={pick}
                onChange={setPick}
                disabled={!canEdit || withholdingLocked}
                error={e.defaultWithholding}
              />
            </div>
          ) : (
            // Persist [] when type is No so the server never keeps a stale pick.
            <input type="hidden" name="defaultWithholdingJson" value={withholding === "NONE" ? "[]" : ""} />
          )}
          {withholdingBlank ? <div className="error">Pick a withholding type and rates (or No withholding) before saving.</div> : null}
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
          <Field label="Notes" name="notes" error={e.notes} full>
            <textarea id="notes" name="notes" defaultValue={v("notes")} rows={3} />
          </Field>
        </div>
        {canEdit && (
          <div className="form-actions">
            <button className="btn" type="submit" disabled={pending || blocked}>
              {pending ? "Saving…" : "Save"}
            </button>
            {blocked && <span className="small faint">Name and customer type are required.</span>}
          </div>
        )}
      </fieldset>
    </form>
  );
}
