"use client";

import Link from "next/link";
import { useFormAction } from "@/components/useFormAction";
import { NoIdUploadWarning } from "@/components/NoIdUploadWarning";
import { CreditLimitWarning } from "@/components/billing/CreditLimitWarning";
import { FileInput } from "@/components/FileInput";
import type { FormState } from "@/lib/validation/forms";

export function BillingForm({
  action,
  defaults,
  salesOrderLabel,
  remaining,
  nextInvoiceHint,
  seriesFrom,
  seriesTo,
  canEdit,
  submitLabel = "Record billing",
  cancelHref = "/billing/billings",
  // D5 edit screen reuses this form but updateBilling takes no files —
  // scans are managed from the billing's Attachments tab, not here.
  showFiles = true,
  // Audit C: warn (don't block) when nothing has been delivered yet.
  deliveryWarning = false,
  // Phase 2 #6: credit-limit warning text from customerExposure (or null).
  creditWarning = null,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  defaults: {
    salesOrderId: string;
    amount: string;
    invoiceNo: string;
    invoiceDate: string;
    dueDate: string;
    notes: string;
  };
  salesOrderLabel: string;
  remaining: string;
  nextInvoiceHint: number | null;
  seriesFrom: number;
  seriesTo: number;
  canEdit: boolean;
  submitLabel?: string;
  cancelHref?: string;
  showFiles?: boolean;
  deliveryWarning?: boolean;
  creditWarning?: string | null;
}) {
  const { state, pending, submit } = useFormAction(action);
  const e = state.fieldErrors ?? {};
  const v = (name: keyof typeof defaults) => state.values?.[name] ?? defaults[name];

  if (!canEdit) {
    return <p className="faint">You can view billings but not record or edit them.</p>;
  }

  return (
    <form
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault();
        submit(ev.currentTarget);
      }}
    >
      <CreditLimitWarning text={creditWarning} />
      {deliveryWarning && (
        <div className="alert warn" role="status">
          Nothing has been delivered on this order yet. You can still record this billing — payment-first
          terms may need the invoice out before delivery — but check the goods are on their way.
        </div>
      )}
      {state.message && (
        <div className={`alert ${state.ok ? "ok" : "error"}`} role="status">
          {state.message}
        </div>
      )}
      <input type="hidden" name="salesOrderId" value={defaults.salesOrderId} />
      <div className="edit-topbar">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
        <Link className="btn btn-secondary" href={cancelHref}>
          Cancel
        </Link>
        <span className="small faint">Printables say “not an official invoice”.</span>
      </div>
      <div className="form-grid">
        <div className="field full">
          <label>Sales order</label>
          <div>{salesOrderLabel}</div>
          <div className="hint">Remaining to bill: ₱{remaining}</div>
        </div>
        <div className={`field${e.amount ? " has-error" : ""}`}>
          <label htmlFor="amount">Amount</label>
          <input id="amount" name="amount" defaultValue={v("amount")} inputMode="decimal" />
          {e.amount && <div className="error">{e.amount}</div>}
        </div>
        <div className={`field${e.invoiceNo ? " has-error" : ""}`}>
          <label htmlFor="invoiceNo">Booklet invoice no.</label>
          <input id="invoiceNo" name="invoiceNo" defaultValue={v("invoiceNo")} inputMode="numeric" />
          {e.invoiceNo ? (
            <div className="error" role="alert">
              {e.invoiceNo}
            </div>
          ) : (
            <div className="hint">
              Series {seriesFrom}–{seriesTo}
              {nextInvoiceHint != null ? ` · next free: ${nextInvoiceHint}` : ""}. Voided numbers are never reused.
            </div>
          )}
        </div>
        <div className={`field${e.invoiceDate ? " has-error" : ""}`}>
          <label htmlFor="invoiceDate">Invoice date</label>
          <input id="invoiceDate" name="invoiceDate" type="date" defaultValue={v("invoiceDate")} />
          {e.invoiceDate && <div className="error">{e.invoiceDate}</div>}
        </div>
        <div className={`field${e.dueDate ? " has-error" : ""}`}>
          <label htmlFor="dueDate">Due date</label>
          <input id="dueDate" name="dueDate" type="date" defaultValue={v("dueDate")} />
          {e.dueDate && <div className="error">{e.dueDate}</div>}
        </div>
        <div className={`field full${e.notes ? " has-error" : ""}`}>
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" rows={3} defaultValue={v("notes")} />
          {e.notes && <div className="error">{e.notes}</div>}
        </div>
        {showFiles && (
          <div className={`field full${e.files ? " has-error" : ""}`}>
            <label htmlFor="files">Scan of filled-in booklet (optional)</label>
            <FileInput id="files" name="files" accept=".pdf,.png,.jpg,.jpeg" multiple />
            <NoIdUploadWarning />
            {e.files ? <div className="error">{e.files}</div> : <div className="hint">PDF, JPG or PNG · max 10 MB each</div>}
          </div>
        )}
      </div>
    </form>
  );
}
