"use client";

import { useFormAction } from "@/components/useFormAction";
import type { FormState } from "@/lib/validation/forms";
import { formatPeso } from "@/lib/format";

type BoundAction = (state: FormState, form: FormData) => Promise<FormState>;

/** Ask an approver to pay (part of) one supplier bill. */
export function PaymentRequestForm({
  action,
  supplierBillId,
  defaultAmount,
  maxAmount,
  defaultDueDate,
}: {
  action: BoundAction;
  supplierBillId: string;
  defaultAmount: string;
  /** The most that can still be requested (outstanding − open requests). */
  maxAmount: string;
  defaultDueDate: string;
}) {
  const { state, pending, submit } = useFormAction(action);
  const e = state.fieldErrors ?? {};
  const v = state.values ?? {};
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
      <input type="hidden" name="supplierBillId" value={supplierBillId} />
      <div className="form-grid">
        <div className={`field${e.amount ? " has-error" : ""}`}>
          <label htmlFor="pr-amount">Amount to pay</label>
          <input
            id="pr-amount"
            name="amount"
            inputMode="decimal"
            defaultValue={v.amount ?? defaultAmount}
            required
          />
          <div className="faint small">Up to {formatPeso(maxAmount)} can still be requested on this bill.</div>
          {e.amount && <div className="error">{e.amount}</div>}
        </div>
        <div className={`field${e.dueDate ? " has-error" : ""}`}>
          <label htmlFor="pr-due">Pay by (due date)</label>
          <input id="pr-due" name="dueDate" type="date" defaultValue={v.dueDate ?? defaultDueDate} required />
          {e.dueDate && <div className="error">{e.dueDate}</div>}
        </div>
        <div className={`field full${e.note ? " has-error" : ""}`}>
          <label htmlFor="pr-note">Note for the approver (optional)</label>
          <textarea id="pr-note" name="note" rows={3} defaultValue={v.note ?? ""} />
          {e.note && <div className="error">{e.note}</div>}
        </div>
      </div>
      <div className="form-actions">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Sending…" : "Request payment"}
        </button>
      </div>
    </form>
  );
}
