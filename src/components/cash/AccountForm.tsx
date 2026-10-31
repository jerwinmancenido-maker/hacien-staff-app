"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import type { FormState } from "@/lib/validation/forms";
import { CASH_ACCOUNT_TYPES, CASH_ACCOUNT_TYPE_HINTS, CASH_ACCOUNT_TYPE_LABELS } from "@/lib/cash/labels";

export function AccountForm({
  action,
  defaults,
  canEdit,
  mode = "create",
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  defaults: {
    name: string;
    type: string;
    bankName: string;
    accountHintLast4: string;
    openingBalance: string;
    openingDate: string;
    active: boolean;
  };
  canEdit: boolean;
  mode?: "create" | "edit";
}) {
  const { state, pending, submit } = useFormAction(action);
  const e = state.fieldErrors ?? {};
  const [type, setType] = useState(defaults.type || "BANK");

  if (!canEdit) {
    return (
      <div className="empty">
        <p className="faint">You can look at accounts, but only an Admin or Approver can change them.</p>
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
        <div className={`field${e.name ? " has-error" : ""}`}>
          <label htmlFor="name">
            Account name<span className="req"> *</span>
          </label>
          <input id="name" name="name" defaultValue={state.values?.name ?? defaults.name} autoComplete="off" />
          <div className="hint">A short name staff will recognize, e.g. “UnionBank operating” or “Petty cash”.</div>
          {e.name && <div className="error">{e.name}</div>}
        </div>
        <div className={`field${e.type ? " has-error" : ""}`}>
          <label htmlFor="type">
            Type<span className="req"> *</span>
          </label>
          <select id="type" name="type" value={type} onChange={(ev) => setType(ev.target.value)}>
            {CASH_ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {CASH_ACCOUNT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <div className="hint">{CASH_ACCOUNT_TYPE_HINTS[type as keyof typeof CASH_ACCOUNT_TYPE_HINTS]}</div>
          {e.type && <div className="error">{e.type}</div>}
        </div>
        {(type === "BANK" || type === "E_WALLET") && (
          <div className={`field${e.bankName ? " has-error" : ""}`}>
            <label htmlFor="bankName">{type === "BANK" ? "Bank name" : "Provider name"}</label>
            <input id="bankName" name="bankName" defaultValue={state.values?.bankName ?? defaults.bankName} placeholder={type === "BANK" ? "UnionBank" : "GCash"} />
            {e.bankName && <div className="error">{e.bankName}</div>}
          </div>
        )}
        <div className={`field${e.accountHintLast4 ? " has-error" : ""}`}>
          <label htmlFor="accountHintLast4">Last 4 digits (optional)</label>
          <input
            id="accountHintLast4"
            name="accountHintLast4"
            defaultValue={state.values?.accountHintLast4 ?? defaults.accountHintLast4}
            maxLength={4}
            inputMode="numeric"
            autoComplete="off"
          />
          <div className="hint">Never enter the full account number — last 4 only, to tell accounts apart.</div>
          {e.accountHintLast4 && <div className="error">{e.accountHintLast4}</div>}
        </div>
        <div className={`field${e.openingBalance ? " has-error" : ""}`}>
          <label htmlFor="openingBalance">
            Opening balance<span className="req"> *</span>
          </label>
          <input
            id="openingBalance"
            name="openingBalance"
            defaultValue={state.values?.openingBalance ?? defaults.openingBalance}
            inputMode="decimal"
          />
          <div className="hint">How much was already in this account on the opening date (₱). Running balance is computed from later entries.</div>
          {e.openingBalance && <div className="error">{e.openingBalance}</div>}
        </div>
        <div className={`field${e.openingDate ? " has-error" : ""}`}>
          <label htmlFor="openingDate">
            Opening date<span className="req"> *</span>
          </label>
          <input id="openingDate" name="openingDate" type="date" defaultValue={state.values?.openingDate ?? defaults.openingDate} />
          {e.openingDate && <div className="error">{e.openingDate}</div>}
        </div>
        <div className="field">
          <label htmlFor="active">
            <input id="active" name="active" type="checkbox" value="on" defaultChecked={defaults.active} /> Active
          </label>
          <div className="hint">Turn off when you no longer use this account. Old entries stay in the ledger.</div>
        </div>
      </div>
      <div className="form-actions">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? "Add account" : "Save changes"}
        </button>
        <Link className="btn btn-secondary" href="/cash/accounts">
          Cancel
        </Link>
      </div>
    </form>
  );
}
