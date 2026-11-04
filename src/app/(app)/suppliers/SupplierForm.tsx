"use client";

import { useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import type { Supplier } from "@prisma/client";
import { Field } from "@/components/Field";
import { SupplierBankAccount } from "@/components/SupplierBankAccount";
import { bankNumberDraft } from "@/lib/bank-mask";
import { SUPPLIER_TAX_TYPES, TAX_TYPE_LABELS } from "@/lib/validation/companies";
import type { FormState } from "@/lib/validation/forms";

export function SupplierForm({
  supplier,
  terms,
  action,
  canEdit,
  canSeeTin = true,
  isAdmin = false,
}: {
  supplier: Supplier | null;
  terms: string[];
  action: (state: FormState, form: FormData) => Promise<FormState>;
  canEdit: boolean;
  /** S-58: false blanks the TIN field (view-only users). */
  canSeeTin?: boolean;
  isAdmin?: boolean;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const v = (k: keyof Supplier) => state.values?.[k] ?? (supplier?.[k] as string | null) ?? "";
  const [name, setName] = useState(v("name"));
  const [bankName, setBankName] = useState(v("bankAccountName"));
  // Stored number stays masked on the record. The input starts empty so a save
  // keeps the current number unless an Admin types a replacement.
  const [bankNumber, setBankNumber] = useState(bankNumberDraft(typeof state.values?.bankAccountNumber === "string" ? state.values.bankAccountNumber : ""));
  const e = state.fieldErrors ?? {};
  const termOptions = supplier?.defaultTerms && !terms.includes(supplier.defaultTerms) ? [...terms, supplier.defaultTerms] : terms;
  const maskedNumber = (supplier?.bankAccountNumber ?? "").trim();
  const hasNumber = maskedNumber.length > 0;
  const noBank = !bankName.trim() || (!hasNumber && !bankNumber.trim());

  return (
    <form onSubmit={onSubmit} noValidate>
      {state.message && (
        <div className={`alert ${state.ok ? "ok" : "error"}`} role="status">
          {state.message}
        </div>
      )}
      {noBank && (
        <div className="alert warn">
          {isAdmin ? "No bank details — add them before paying." : "No bank details recorded."}
        </div>
      )}
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-grid">
          <Field label="Name" name="name" required error={e.name} full>
            <input id="name" name="name" type="text" value={name} onChange={(ev) => setName(ev.target.value)} />
          </Field>
          <Field label="TIN" name="tin" error={e.tin} hint="000-000-000-000 · branch code optional">
            <input id="tin" name="tin" type="text" defaultValue={canSeeTin ? v("tin") : ""} inputMode="numeric" placeholder="000-000-000-000" />
          </Field>
          <Field label="Tax type" name="taxType" required error={e.taxType}>
            <select id="taxType" name="taxType" defaultValue={v("taxType") || "VAT"}>
              {SUPPLIER_TAX_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TAX_TYPE_LABELS[t]}
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
          {isAdmin && <h3 className="section-title">UnionBank details</h3>}
          {supplier && (
            <div className="field full">
              <div className="label">Account number</div>
              <div className="field-control-row">
                <SupplierBankAccount supplierId={supplier.id} initialValue={maskedNumber} isAdmin={isAdmin} />
              </div>
            </div>
          )}
          {isAdmin && (
            <>
              <Field label="Account name" name="bankAccountName" error={e.bankAccountName}>
                <input id="bankAccountName" name="bankAccountName" type="text" value={bankName} onChange={(ev) => setBankName(ev.target.value)} />
              </Field>
              <Field
                label={hasNumber ? "New account number" : "Account number"}
                name="bankAccountNumber"
                error={e.bankAccountNumber}
                hint={hasNumber ? "Leave blank to keep the current number." : undefined}
              >
                <input
                  id="bankAccountNumber"
                  name="bankAccountNumber"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={bankNumber}
                  onChange={(ev) => setBankNumber(ev.target.value)}
                  placeholder={hasNumber ? "Type a new number" : ""}
                />
              </Field>
              <Field label="Bank / branch" name="bankBranch" error={e.bankBranch}>
                <input id="bankBranch" name="bankBranch" type="text" defaultValue={v("bankBranch")} placeholder="UnionBank – Ortigas" />
              </Field>
              <Field label="Bank notes" name="bankNotes" error={e.bankNotes}>
                <input id="bankNotes" name="bankNotes" type="text" defaultValue={v("bankNotes")} />
              </Field>
            </>
          )}
          <Field label="Notes" name="notes" error={e.notes} full>
            <textarea id="notes" name="notes" defaultValue={v("notes")} rows={3} />
          </Field>
        </div>
        {canEdit && (
          <div className="form-actions">
            <button className="btn" type="submit" disabled={pending || !name.trim()}>
              {pending ? "Saving…" : "Save"}
            </button>
            {!name.trim() && <span className="small faint">Name is required.</span>}
          </div>
        )}
      </fieldset>
    </form>
  );
}
