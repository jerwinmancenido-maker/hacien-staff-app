"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import type { FormState } from "@/lib/validation/forms";
import { CashAccountSelect, type CashAccountOption } from "./CashAccountSelect";

export function ExpenseForm({
  action,
  defaults,
  accounts,
  categories,
  suppliers,
  canEdit,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  defaults: {
    date: string;
    supplierId: string;
    payeeText: string;
    categoryId: string;
    amount: string;
    withholdingApplied: string;
    cashAccountId: string;
    receiptNo: string;
    notes: string;
  };
  accounts: CashAccountOption[];
  categories: { id: string; label: string }[];
  suppliers: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const { state, pending, submit } = useFormAction(action);
  const e = state.fieldErrors ?? {};
  const [useSupplier, setUseSupplier] = useState(!!defaults.supplierId);
  const [showWh, setShowWh] = useState(!!defaults.withholdingApplied && defaults.withholdingApplied !== "0" && defaults.withholdingApplied !== "0.00");

  if (!canEdit) {
    return (
      <div className="empty">
        <p className="faint">You can look at expenses, but only an Admin or Approver can record one.</p>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="empty">
        <p>Add a cash or bank account first — every expense is paid from one.</p>
        <p style={{ marginTop: 12 }}>
          <Link className="btn" href="/cash/accounts/new">
            Add your first bank account
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault();
        submit(ev.currentTarget);
      }}
    >
      {state.message && (
        <div className={`alert ${state.ok ? "ok" : "error"}`} role="status">
          {state.message}
        </div>
      )}
      <div className="form-grid">
        <div className={`field${e.date ? " has-error" : ""}`}>
          <label htmlFor="date">
            Date<span className="req"> *</span>
          </label>
          <input id="date" name="date" type="date" defaultValue={state.values?.date ?? defaults.date} />
          {e.date && <div className="error">{e.date}</div>}
        </div>
        <div className={`field${e.categoryId ? " has-error" : ""}`}>
          <label htmlFor="categoryId">
            Category<span className="req"> *</span>
          </label>
          <select id="categoryId" name="categoryId" defaultValue={state.values?.categoryId ?? defaults.categoryId}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <div className="hint">What kind of cost this is (rent, internet, etc.).</div>
          {e.categoryId && <div className="error">{e.categoryId}</div>}
        </div>
        <div className={`field${e.amount ? " has-error" : ""}`}>
          <label htmlFor="amount">
            Amount paid<span className="req"> *</span>
          </label>
          <input id="amount" name="amount" defaultValue={state.values?.amount ?? defaults.amount} inputMode="decimal" />
          <div className="hint">Cash that left the account (₱). Do not include VAT input tax — HACIEN is non-VAT.</div>
          {e.amount && <div className="error">{e.amount}</div>}
        </div>
        <CashAccountSelect
          accounts={accounts}
          defaultValue={state.values?.cashAccountId ?? defaults.cashAccountId}
          required
          error={e.cashAccountId}
          label="Paid from"
          hint="Which cash or bank account the money left."
        />
        <div className="field full">
          <label>Who was paid?</label>
          <div className="hint" style={{ marginBottom: 8 }}>
            Pick a supplier from your list, or type any other payee name.
          </div>
          <div style={{ display: "flex", gap: 16, marginBottom: 8 }}>
            <label>
              <input type="radio" checked={useSupplier} onChange={() => setUseSupplier(true)} /> Existing supplier
            </label>
            <label>
              <input type="radio" checked={!useSupplier} onChange={() => setUseSupplier(false)} /> Other payee
            </label>
          </div>
          {useSupplier ? (
            <div className={`field${e.supplierId ? " has-error" : ""}`} style={{ margin: 0 }}>
              <select id="supplierId" name="supplierId" defaultValue={state.values?.supplierId ?? defaults.supplierId}>
                <option value="">Pick a supplier…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <input type="hidden" name="payeeText" value="" />
              {e.supplierId && <div className="error">{e.supplierId}</div>}
              {e.payeeText && <div className="error">{e.payeeText}</div>}
            </div>
          ) : (
            <div className={`field${e.payeeText ? " has-error" : ""}`} style={{ margin: 0 }}>
              <input
                id="payeeText"
                name="payeeText"
                defaultValue={state.values?.payeeText ?? defaults.payeeText}
                placeholder="e.g. Meralco, PLDT, landlord"
              />
              <input type="hidden" name="supplierId" value="" />
              {e.payeeText && <div className="error">{e.payeeText}</div>}
            </div>
          )}
        </div>
        <div className={`field${e.receiptNo ? " has-error" : ""}`}>
          <label htmlFor="receiptNo">OR / receipt no.</label>
          <input id="receiptNo" name="receiptNo" defaultValue={state.values?.receiptNo ?? defaults.receiptNo} />
          <div className="hint">Official receipt or acknowledgment number from the payee (manual).</div>
          {e.receiptNo && <div className="error">{e.receiptNo}</div>}
        </div>
        <div className="field full">
          <label>
            <input type="checkbox" checked={showWh} onChange={(ev) => setShowWh(ev.target.checked)} /> Withholding (EWT) applied
          </label>
          <div className="hint">Optional. Expanded withholding tax if you withheld on this payment. Cash leaving the account is still the amount above.</div>
        </div>
        {showWh && (
          <div className={`field${e.withholdingApplied ? " has-error" : ""}`}>
            <label htmlFor="withholdingApplied">Withholding amount</label>
            <input
              id="withholdingApplied"
              name="withholdingApplied"
              defaultValue={state.values?.withholdingApplied ?? defaults.withholdingApplied}
              inputMode="decimal"
            />
            {e.withholdingApplied && <div className="error">{e.withholdingApplied}</div>}
          </div>
        )}
        {!showWh && <input type="hidden" name="withholdingApplied" value="0" />}
        <div className="field full">
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" rows={2} defaultValue={state.values?.notes ?? defaults.notes} />
        </div>
        <div className={`field full${e.files ? " has-error" : ""}`}>
          <label htmlFor="files">Receipt photo / PDF (optional)</label>
          <input id="files" name="files" type="file" accept=".pdf,.png,.jpg,.jpeg" multiple />
          {e.files && <div className="error">{e.files}</div>}
        </div>
      </div>
      <div className="form-actions">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Record expense"}
        </button>
        <Link className="btn btn-secondary" href="/cash/expenses">
          Cancel
        </Link>
      </div>
    </form>
  );
}
