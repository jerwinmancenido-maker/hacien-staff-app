"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import type { FormState } from "@/lib/validation/forms";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/lib/validation/payables";
import { formatDate, formatPeso } from "@/lib/format";

export type OpenBillRow = {
  id: string;
  billNumber: string;
  dueDate: string;
  amount: string;
  balance: string;
};

type AllocRow = { billId: string; cash: string; withholding: string; rate: string; atc: string };

function money2(n: number) {
  return (Math.round(n * 100) / 100).toFixed(2);
}

function autoAllocate(amountPaid: number, bills: OpenBillRow[]): AllocRow[] {
  let left = amountPaid;
  return bills.map((b) => {
    const bal = Number(b.balance) || 0;
    const take = left > 0 ? Math.min(bal, left) : 0;
    left -= take;
    return {
      billId: b.id,
      cash: take > 0 ? money2(take) : "",
      withholding: "",
      rate: "",
      atc: "",
    };
  });
}

function dayLabel(ymd: string) {
  try {
    return formatDate(new Date(`${ymd}T00:00:00.000Z`));
  } catch {
    return ymd;
  }
}

export function PaymentForm({
  action,
  supplierId,
  supplierName,
  defaults,
  openBills,
  canEdit,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  supplierId: string;
  supplierName: string;
  defaults: { date: string; amountPaid: string; method: string };
  openBills: OpenBillRow[];
  canEdit: boolean;
}) {
  const { state, pending, submit } = useFormAction(action);
  const e = state.fieldErrors ?? {};
  const [method, setMethod] = useState(defaults.method || "BANK_TRANSFER");
  const [showEwt, setShowEwt] = useState(false);

  const totalOpen = useMemo(
    () => money2(openBills.reduce((a, b) => a + (Number(b.balance) || 0), 0)),
    [openBills],
  );

  const startingAmount = defaults.amountPaid || (Number(totalOpen) > 0 ? totalOpen : "");
  const [amount, setAmount] = useState(startingAmount);
  const [allocs, setAllocs] = useState<AllocRow[]>(() => autoAllocate(Number(startingAmount) || 0, openBills));

  if (!canEdit) {
    return (
      <div className="empty">
        <p className="faint">You can look at payments, but only an Admin or Approver can record one.</p>
      </div>
    );
  }

  if (openBills.length === 0) {
    return (
      <div className="empty">
        <p>
          <b>{supplierName}</b> has no unpaid bills to pay against.
        </p>
        <p className="faint">Record a supplier bill on a purchase order first, then come back here.</p>
        <p style={{ marginTop: 12 }}>
          <Link className="btn btn-secondary" href={`/suppliers/${supplierId}`}>
            Open supplier
          </Link>{" "}
          <Link className="btn" href="/purchase-orders">
            Go to supplier POs
          </Link>
        </p>
      </div>
    );
  }

  const setAmountAndAlloc = (raw: string) => {
    setAmount(raw);
    setAllocs(autoAllocate(Number(raw) || 0, openBills));
  };

  const cashSum = allocs.reduce((a, x) => a + (Number(x.cash) || 0), 0);
  const whSum = allocs.reduce((a, x) => a + (Number(x.withholding) || 0), 0);
  const paid = Number(amount) || 0;
  const leftToAllocate = Math.round((paid - cashSum) * 100) / 100;
  const canSave = paid > 0 && leftToAllocate === 0;

  const updateAlloc = (i: number, patch: Partial<AllocRow>) => {
    const next = [...allocs];
    next[i] = { ...next[i]!, ...patch };
    setAllocs(next);
  };

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
      <input type="hidden" name="supplierId" value={supplierId} />

      <div className="form-grid">
        <div className="field full">
          <label>Supplier</label>
          <div>
            <Link href={`/suppliers/${supplierId}`}>{supplierName}</Link>
            <div className="hint">Open balance: {formatPeso(totalOpen)}</div>
          </div>
        </div>

        <div className={`field${e.date ? " has-error" : ""}`}>
          <label htmlFor="date">Date paid</label>
          <input id="date" name="date" type="date" defaultValue={state.values?.date ?? defaults.date} />
          <div className="hint">Defaults to today.</div>
          {e.date && <div className="error">{e.date}</div>}
        </div>

        <div className={`field${e.method ? " has-error" : ""}`}>
          <label htmlFor="method">How you paid</label>
          <select id="method" name="method" value={method} onChange={(ev) => setMethod(ev.target.value)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
          {e.method && <div className="error">{e.method}</div>}
        </div>

        <div className={`field${e.reference ? " has-error" : ""}`}>
          <label htmlFor="reference">{method === "CHECK" ? "Check number" : "Bank / e-wallet reference"}</label>
          <input
            id="reference"
            name="reference"
            placeholder={method === "CHECK" ? "e.g. 0012345" : "e.g. transfer or GCash reference"}
            defaultValue={state.values?.reference ?? ""}
          />
          {e.reference && <div className="error">{e.reference}</div>}
        </div>

        {method === "CHECK" && (
          <>
            <div className={`field${e.checkBank ? " has-error" : ""}`}>
              <label htmlFor="checkBank">Bank name</label>
              <input id="checkBank" name="checkBank" placeholder="e.g. UnionBank" defaultValue={state.values?.checkBank ?? ""} />
              {e.checkBank && <div className="error">{e.checkBank}</div>}
            </div>
            <div className={`field${e.checkDate ? " has-error" : ""}`}>
              <label htmlFor="checkDate">Check date</label>
              <input id="checkDate" name="checkDate" type="date" defaultValue={state.values?.checkDate ?? ""} />
              {e.checkDate && <div className="error">{e.checkDate}</div>}
            </div>
          </>
        )}

        <div className={`field${e.amountPaid ? " has-error" : ""}`}>
          <label htmlFor="amountPaid">Cash paid</label>
          <input
            id="amountPaid"
            name="amountPaid"
            inputMode="decimal"
            value={amount}
            onChange={(ev) => setAmountAndAlloc(ev.target.value)}
          />
          <div className="hint">
            Starts as the total still owed ({formatPeso(totalOpen)}). Change it if you paid less.{" "}
            <button type="button" className="btn-link small" onClick={() => setAmountAndAlloc(totalOpen)}>
              Reset to full balance
            </button>
          </div>
          {e.amountPaid && <div className="error">{e.amountPaid}</div>}
        </div>

        <div className={`field full${e.notes ? " has-error" : ""}`}>
          <label htmlFor="notes">Notes (optional)</label>
          <textarea id="notes" name="notes" rows={2} defaultValue={state.values?.notes ?? ""} />
          {e.notes && <div className="error">{e.notes}</div>}
        </div>

        <div className="field full">
          <label htmlFor="files">Proof of payment (optional)</label>
          <input id="files" name="files" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" multiple />
          <div className="hint">Bank screenshot or deposit slip — PDF, JPG or PNG, up to 5 files.</div>
          {e.files && <div className="error">{e.files}</div>}
        </div>
      </div>

      <h3 className="section-title" style={{ marginTop: 24 }}>
        Apply to unpaid bills
      </h3>
      <p className="faint small">
        Put the cash against the oldest bills first. The amounts below must add up to the cash paid.
      </p>

      {e.allocations && (
        <div className="alert error" role="status">
          {e.allocations}
        </div>
      )}

      <div className="table-wrap">
        <table className="list" aria-label="Apply payment to bills">
          <thead>
            <tr>
              <th>Supplier bill</th>
              <th>Due</th>
              <th className="num">Still owed</th>
              <th className="num">Cash on this payment</th>
              {showEwt && (
                <>
                  <th className="num">Withheld (EWT)</th>
                  <th className="num">Rate %</th>
                  <th>ATC code</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {openBills.map((b, i) => {
              const row = allocs[i] ?? { billId: b.id, cash: "", withholding: "", rate: "", atc: "" };
              return (
                <tr key={b.id}>
                  <td>
                    <input type="hidden" name="allocBillId" value={b.id} />
                    <span className="strong">{b.billNumber}</span>
                    <div className="faint small">Bill total {formatPeso(b.amount)}</div>
                  </td>
                  <td>{dayLabel(b.dueDate)}</td>
                  <td className="num">{formatPeso(b.balance)}</td>
                  <td className="num">
                    <input
                      className="input"
                      name="allocCash"
                      inputMode="decimal"
                      aria-label={`Cash for bill ${b.billNumber}`}
                      value={row.cash}
                      onChange={(ev) => updateAlloc(i, { cash: ev.target.value })}
                      style={{ width: 110, textAlign: "right" }}
                    />
                  </td>
                  {showEwt && (
                    <>
                      <td className="num">
                        <input
                          className="input"
                          name="allocWithholding"
                          inputMode="decimal"
                          aria-label={`Withholding for bill ${b.billNumber}`}
                          value={row.withholding}
                          onChange={(ev) => updateAlloc(i, { withholding: ev.target.value })}
                          style={{ width: 100, textAlign: "right" }}
                        />
                      </td>
                      <td className="num">
                        <input
                          className="input"
                          name="allocRate"
                          inputMode="decimal"
                          placeholder="1"
                          aria-label={`Rate % for bill ${b.billNumber}`}
                          value={row.rate}
                          onChange={(ev) => updateAlloc(i, { rate: ev.target.value })}
                          style={{ width: 64, textAlign: "right" }}
                        />
                      </td>
                      <td>
                        <input
                          className="input"
                          name="allocAtc"
                          placeholder="e.g. WC010"
                          aria-label={`ATC for bill ${b.billNumber}`}
                          value={row.atc}
                          onChange={(ev) => updateAlloc(i, { atc: ev.target.value })}
                          style={{ width: 88 }}
                        />
                      </td>
                    </>
                  )}
                  {!showEwt && (
                    <>
                      <input type="hidden" name="allocWithholding" value={row.withholding || "0"} />
                      <input type="hidden" name="allocRate" value={row.rate || "0"} />
                      <input type="hidden" name="allocAtc" value={row.atc || ""} />
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="faint small" style={{ marginTop: 8 }}>
        <button type="button" className="btn-link small" onClick={() => setShowEwt((v) => !v)}>
          {showEwt ? "Hide withholding (EWT)" : "Add withholding (EWT) — uncommon; pending RDO"}
        </button>
      </p>

      <div
        className={`card${leftToAllocate !== 0 ? " alert-ish" : ""}`}
        style={{ marginTop: 16, padding: "12px 16px", background: leftToAllocate === 0 ? "#EEF4EF" : "#F8F3E8" }}
        role="status"
        aria-live="polite"
      >
        <dl className="kv" style={{ margin: 0 }}>
          <dt>Cash paid</dt>
          <dd className="num">{formatPeso(money2(paid))}</dd>
          <dt>Applied to bills</dt>
          <dd className="num">{formatPeso(money2(cashSum))}</dd>
          <dt>
            <b>Left to allocate</b>
          </dt>
          <dd className="num strong">
            {leftToAllocate === 0
              ? "₱0.00 — ready to save"
              : leftToAllocate > 0
                ? `${formatPeso(money2(leftToAllocate))} still needs to go on a bill`
                : `${formatPeso(money2(-leftToAllocate))} too much on bills — lower a cash amount`}
          </dd>
          {whSum > 0 && (
            <>
              <dt>Withholding total</dt>
              <dd className="num">{formatPeso(money2(whSum))}</dd>
            </>
          )}
        </dl>
      </div>

      <div style={{ marginTop: 20, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn" type="submit" disabled={pending || !canSave}>
          {pending ? "Saving…" : "Save payment"}
        </button>
        {!canSave && paid > 0 && (
          <span className="faint small">Fix “Left to allocate” to ₱0.00 before saving.</span>
        )}
        <Link className="btn btn-secondary" href="/payables/payments">
          Cancel
        </Link>
      </div>
    </form>
  );
}
