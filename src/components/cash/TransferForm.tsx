"use client";

import Link from "next/link";
import { useFormAction } from "@/components/useFormAction";
import type { FormState } from "@/lib/validation/forms";
import { CashAccountSelect, type CashAccountOption } from "./CashAccountSelect";

export function TransferForm({
  action,
  defaults,
  accounts,
  canEdit,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  defaults: { date: string; fromAccountId: string; toAccountId: string; amount: string; notes: string };
  accounts: CashAccountOption[];
  canEdit: boolean;
}) {
  const { state, pending, submit } = useFormAction(action);
  const e = state.fieldErrors ?? {};

  if (!canEdit) {
    return (
      <div className="empty">
        <p className="faint">You can look at transfers, but only an Admin or Approver can record one.</p>
      </div>
    );
  }

  if (accounts.length < 2) {
    return (
      <div className="empty">
        <p>You need at least two cash / bank accounts to move money between them.</p>
        <p className="faint">Example: deposit cash on hand into the UnionBank account.</p>
        <p style={{ marginTop: 12 }}>
          <Link className="btn" href="/cash/accounts/new">
            Add another account
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
        <div className={`field${e.amount ? " has-error" : ""}`}>
          <label htmlFor="amount">
            Amount<span className="req"> *</span>
          </label>
          <input id="amount" name="amount" defaultValue={state.values?.amount ?? defaults.amount} inputMode="decimal" />
          {e.amount && <div className="error">{e.amount}</div>}
        </div>
        <CashAccountSelect
          name="fromAccountId"
          id="fromAccountId"
          accounts={accounts}
          defaultValue={state.values?.fromAccountId ?? defaults.fromAccountId}
          required
          error={e.fromAccountId}
          label="From account"
          hint="Where the money left (e.g. Cash on hand)."
        />
        <CashAccountSelect
          name="toAccountId"
          id="toAccountId"
          accounts={accounts}
          defaultValue={state.values?.toAccountId ?? defaults.toAccountId}
          required
          error={e.toAccountId}
          label="To account"
          hint="Where the money went (e.g. bank deposit)."
        />
        <div className="field full">
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" rows={2} defaultValue={state.values?.notes ?? defaults.notes} />
        </div>
      </div>
      <div className="form-actions">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Record transfer"}
        </button>
        <Link className="btn btn-secondary" href="/cash/transfers">
          Cancel
        </Link>
      </div>
    </form>
  );
}
