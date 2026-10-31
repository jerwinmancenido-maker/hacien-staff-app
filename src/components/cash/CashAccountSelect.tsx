"use client";

import Link from "next/link";

/** Shared cash-account picker for collections, payments, expenses, transfers. */

export type CashAccountOption = {
  id: string;
  name: string;
  typeLabel: string;
  hint?: string | null;
};

export function CashAccountSelect({
  name = "cashAccountId",
  id = "cashAccountId",
  accounts,
  defaultValue,
  required = false,
  allowBlank = false,
  blankLabel = "Not assigned",
  error,
  label = "Cash / bank account",
  hint = "Which wallet or bank this money belongs to. The app never connects to a bank — this is for your records only.",
}: {
  name?: string;
  id?: string;
  accounts: CashAccountOption[];
  defaultValue?: string | null;
  required?: boolean;
  allowBlank?: boolean;
  blankLabel?: string;
  error?: string;
  label?: string;
  hint?: string;
}) {
  return (
    <div className={`field${error ? " has-error" : ""}`}>
      <label htmlFor={id}>
        {label}
        {required && <span className="req"> *</span>}
      </label>
      {accounts.length === 0 ? (
        <>
          <input type="hidden" name={name} value="" />
          <p className="faint small">
            No cash accounts yet.{" "}
            <Link href="/cash/accounts/new">Add your first bank account</Link> so balances can be tracked.
          </p>
        </>
      ) : (
        <select id={id} name={name} defaultValue={defaultValue ?? (allowBlank ? "" : accounts[0]?.id ?? "")} required={required}>
          {allowBlank && <option value="">{blankLabel}</option>}
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.hint ? ` · ···${a.hint}` : ""} ({a.typeLabel})
            </option>
          ))}
        </select>
      )}
      {hint && <div className="hint">{hint}</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
