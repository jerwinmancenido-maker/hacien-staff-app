"use client";

import { useState } from "react";
import { formatDate } from "@/lib/format";
import { useFormAction } from "@/components/useFormAction";
import { updateSalesOrderGovDealAction } from "@/app/(app)/sales-orders/actions";

const day = (ymd: string | null | undefined) =>
  ymd ? formatDate(new Date(`${ymd}T00:00:00.000Z`)) : "—";

type GovDealProps = {
  so: {
    id: string;
    philgepsRef?: string | null;
    bidNo?: string | null;
    noaDate?: string | null;
    agencyPoNo?: string | null;
    iarDate?: string | null;
    status: string;
  };
  canEdit: boolean;
};

export function GovernmentDealBox({ so, canEdit }: GovDealProps) {
  const [editing, setEditing] = useState(false);
  const actionWithId = updateSalesOrderGovDealAction.bind(null, so.id);
  const { state, pending, onSubmit } = useFormAction(async (prev, form) => {
    const res = await actionWithId(prev, form);
    if (res.ok) setEditing(false);
    return res;
  });

  return (
    <div className="card" aria-label="Government deal">
      <div className="card-head">
        <h2>Government deal</h2>
        {canEdit && so.status !== "VOID" && !editing && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <form onSubmit={onSubmit} noValidate>
          {state.message && (
            <div className={`alert ${state.ok ? "ok" : "error"}`} role="alert">
              {state.message}
            </div>
          )}
          <div className="form-grid">
            <div className="field">
              <label htmlFor="philgepsRef">PhilGEPS ref</label>
              <input
                id="philgepsRef"
                name="philgepsRef"
                type="text"
                className="input"
                defaultValue={so.philgepsRef ?? ""}
              />
            </div>
            <div className="field">
              <label htmlFor="bidNo">Bid no.</label>
              <input
                id="bidNo"
                name="bidNo"
                type="text"
                className="input"
                defaultValue={so.bidNo ?? ""}
              />
            </div>
            <div className="field">
              <label htmlFor="noaDate">NOA date</label>
              <input
                id="noaDate"
                name="noaDate"
                type="date"
                className="input"
                defaultValue={so.noaDate ?? ""}
              />
            </div>
            <div className="field">
              <label htmlFor="agencyPoNo">Agency PO no.</label>
              <input
                id="agencyPoNo"
                name="agencyPoNo"
                type="text"
                className="input"
                defaultValue={so.agencyPoNo ?? ""}
              />
            </div>
            <div className="field">
              <label htmlFor="iarDate">IAR date</label>
              <input
                id="iarDate"
                name="iarDate"
                type="date"
                className="input"
                defaultValue={so.iarDate ?? ""}
              />
            </div>
          </div>
          <div className="form-actions" style={{ marginTop: "12px" }}>
            <button className="btn" type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save government deal"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <dl className="kv kv-grid">
          <dt>PhilGEPS ref</dt>
          <dd>{so.philgepsRef ?? "—"}</dd>
          <dt>Bid no.</dt>
          <dd>{so.bidNo ?? "—"}</dd>
          <dt>NOA date</dt>
          <dd>{day(so.noaDate)}</dd>
          <dt>Agency PO no.</dt>
          <dd>{so.agencyPoNo ?? "—"}</dd>
          <dt>IAR date</dt>
          <dd>{day(so.iarDate)}</dd>
        </dl>
      )}
    </div>
  );
}
