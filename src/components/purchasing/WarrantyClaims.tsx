"use client";

// Phase 3 #8b: warranty claim forms on the receiving PO page.
// Create form per POSTED receiving line (supplier / PO / serials come
// from the receiving record — W1); status form per claim, offering
// only the moves the approved status set allows.

import { useFormAction } from "../useFormAction";
import type { FormState } from "@/lib/validation/forms";
import {
  WARRANTY_CLAIM_STATUS_LABELS,
  WARRANTY_CLAIM_TRANSITIONS,
  splitSerialNumbers,
  type WarrantyClaimStatus,
} from "@/lib/purchasing/warranty-claims-shared";

type ClaimAction = (state: FormState, form: FormData) => Promise<FormState>;

export function WarrantyClaimCreateForm({
  itemDescription,
  serialNumbers,
  reportStatus,
  action,
}: {
  itemDescription: string;
  serialNumbers: string | null;
  reportStatus: string;
  action: ClaimAction;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const serials = splitSerialNumbers(serialNumbers);
  if (reportStatus === "VOID") {
    return <p className="small faint">Receiving report is void — claims cannot be filed on it.</p>;
  }
  const e = state.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} style={{ marginTop: 8 }}>
      <div className="small strong">File a warranty claim — {itemDescription.split("\n")[0]}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        {serials.length > 1 ? (
          <select name="serialNumber" aria-label="Serial number" defaultValue="">
            <option value="">Whole line (no single serial)</option>
            {serials.map((s) => (
              <option key={s} value={s}>
                Serial {s}
              </option>
            ))}
          </select>
        ) : serials.length === 1 ? (
          <>
            <input type="hidden" name="serialNumber" value={serials[0]} />
            <span className="small faint">Serial: {serials[0]}</span>
          </>
        ) : (
          <input name="serialNumber" aria-label="Serial number (optional)" placeholder="Serial (optional)" maxLength={100} />
        )}
        <input name="supplierRef" aria-label="Supplier claim reference (optional)" placeholder="Supplier ref (optional)" maxLength={64} />
      </div>
      <div style={{ marginTop: 6 }}>
        <textarea name="fault" aria-label="What is wrong with the item" placeholder="What is wrong with the item?" required maxLength={2000} rows={2} style={{ width: "100%" }} />
        {e.fault ? <div className="small" role="alert">{e.fault}</div> : null}
        {e.serialNumber ? <div className="small" role="alert">{e.serialNumber}</div> : null}
      </div>
      <div className="form-actions">
        <button className="btn btn-secondary" type="submit" disabled={pending}>
          File claim
        </button>
        {state.message ? (
          <span className="small" role="status">
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}

export function WarrantyClaimStatusForm({
  status,
  action,
}: {
  status: string;
  action: ClaimAction;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const next = WARRANTY_CLAIM_TRANSITIONS[status as WarrantyClaimStatus] ?? [];
  if (next.length === 0) {
    return <span className="small faint">Final status</span>;
  }
  return (
    <form onSubmit={onSubmit} style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <select name="status" aria-label="Move claim to" defaultValue={next[0]}>
        {next.map((s) => (
          <option key={s} value={s}>
            {WARRANTY_CLAIM_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      <button className="btn btn-secondary" type="submit" disabled={pending}>
        Update
      </button>
      {state.message ? (
        <span className="small" role="status">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
