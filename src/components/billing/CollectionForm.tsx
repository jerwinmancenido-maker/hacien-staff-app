"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import type { FormState } from "@/lib/validation/forms";
import { COLLECTION_METHODS, COLLECTION_METHOD_LABELS } from "@/lib/validation/billing";
import { formatPeso } from "@/lib/format";
import { CashAccountSelect, type CashAccountOption } from "@/components/cash/CashAccountSelect";

export type OpenBillingRow = {
  id: string;
  invoiceNo: number;
  number: string;
  dueDate: string;
  amount: string;
  balance: string;
  defaultRate: string;
  defaultAtc: string | null;
};

export function CollectionForm({
  action,
  customerId,
  customerName,
  defaults,
  openBillings,
  cashAccounts = [],
  cashEnabled = false,
  canEdit,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  customerId: string;
  customerName: string;
  defaults: { date: string; amountReceived: string; method: string; receiptNo: string; cashAccountId?: string };
  openBillings: OpenBillingRow[];
  cashAccounts?: CashAccountOption[];
  /** When false (CASH_ENABLED off), hide the deposited-to account selector. */
  cashEnabled?: boolean;
  canEdit: boolean;
}) {
  const { state, pending, submit } = useFormAction(action);
  const e = state.fieldErrors ?? {};
  const [method, setMethod] = useState(defaults.method || "CASH");
  const [amount, setAmount] = useState(defaults.amountReceived);

  const initialAlloc = useMemo(() => {
    const { rows } = openBillings.reduce<{ left: number; rows: { billingId: string; cash: string; withholding: string; rate: string; atc: string }[] }>(
      (acc, b) => {
        const bal = Number(b.balance);
        const take = acc.left > 0 ? Math.min(bal, acc.left) : 0;
        return {
          left: acc.left - take,
          rows: [
            ...acc.rows,
            {
              billingId: b.id,
              cash: take > 0 ? take.toFixed(2) : "",
              withholding: "",
              rate: b.defaultRate,
              atc: b.defaultAtc ?? "",
            },
          ],
        };
      },
      { left: Number(defaults.amountReceived) || 0, rows: [] },
    );
    return rows;
  }, [openBillings, defaults.amountReceived]);

  const [allocs, setAllocs] = useState(initialAlloc);

  if (!canEdit) return <p className="faint">You can view collections but not record them.</p>;

  const cashSum = allocs.reduce((a, x) => a + (Number(x.cash) || 0), 0);
  const unapplied = Math.max(0, (Number(amount) || 0) - cashSum);

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
      <input type="hidden" name="customerId" value={customerId} />
      <div className="form-grid">
        <div className="field full">
          <label>Customer</label>
          <div>
            <Link href={`/customers/${customerId}`}>{customerName}</Link>
          </div>
        </div>
        <div className={`field${e.date ? " has-error" : ""}`}>
          <label htmlFor="date">Date</label>
          <input id="date" name="date" type="date" defaultValue={state.values?.date ?? defaults.date} />
          {e.date && <div className="error">{e.date}</div>}
        </div>
        <div className={`field${e.method ? " has-error" : ""}`}>
          <label htmlFor="method">Method</label>
          <select id="method" name="method" value={method} onChange={(ev) => setMethod(ev.target.value)}>
            {COLLECTION_METHODS.map((m) => (
              <option key={m} value={m}>
                {COLLECTION_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
          {e.method && <div className="error">{e.method}</div>}
        </div>
        <div className={`field${e.amountReceived ? " has-error" : ""}`}>
          <label htmlFor="amountReceived">Amount received</label>
          <input
            id="amountReceived"
            name="amountReceived"
            value={amount}
            onChange={(ev) => setAmount(ev.target.value)}
            inputMode="decimal"
          />
          {e.amountReceived && <div className="error">{e.amountReceived}</div>}
        </div>
        <div className={`field${e.receiptNo ? " has-error" : ""}`}>
          <label htmlFor="receiptNo">OR / acknowledgment receipt no.</label>
          <input id="receiptNo" name="receiptNo" defaultValue={state.values?.receiptNo ?? defaults.receiptNo} />
          <div className="hint">Manual — the app does not issue official receipts.</div>
          {e.receiptNo && <div className="error">{e.receiptNo}</div>}
        </div>
        {cashEnabled && (
          <CashAccountSelect
            accounts={cashAccounts}
            defaultValue={state.values?.cashAccountId ?? defaults.cashAccountId ?? ""}
            allowBlank
            blankLabel={cashAccounts.length ? "Not assigned" : "Not assigned (add a cash account later)"}
            error={e.cashAccountId}
            label="Deposited to"
            hint="Which cash or bank account received this money. Leave blank if you are not sure yet."
          />
        )}
        {(method === "CHECK" || method === "BANK_TRANSFER" || method === "GCASH") && (
          <div className={`field${e.reference ? " has-error" : ""}`}>
            <label htmlFor="reference">{method === "CHECK" ? "Check no." : "Reference no."}</label>
            <input id="reference" name="reference" defaultValue={state.values?.reference ?? ""} />
            {e.reference && <div className="error">{e.reference}</div>}
          </div>
        )}
        {method === "CHECK" && (
          <>
            <div className={`field${e.checkBank ? " has-error" : ""}`}>
              <label htmlFor="checkBank">Bank</label>
              <input id="checkBank" name="checkBank" defaultValue={state.values?.checkBank ?? ""} />
              {e.checkBank && <div className="error">{e.checkBank}</div>}
            </div>
            <div className={`field${e.checkDate ? " has-error" : ""}`}>
              <label htmlFor="checkDate">Check date</label>
              <input id="checkDate" name="checkDate" type="date" defaultValue={state.values?.checkDate ?? ""} />
              {e.checkDate && <div className="error">{e.checkDate}</div>}
            </div>
          </>
        )}
        <div className="field full">
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" rows={2} defaultValue={state.values?.notes ?? ""} />
        </div>
        <div className={`field full${e.files ? " has-error" : ""}`}>
          <label htmlFor="files">Attachment (optional)</label>
          <input id="files" name="files" type="file" accept=".pdf,.png,.jpg,.jpeg" multiple />
          {e.files && <div className="error">{e.files}</div>}
        </div>
      </div>

      <h3 className="section-title" style={{ marginTop: 24 }}>
        Allocate to open billings
      </h3>
      <p className="faint small">
        Leave cash unallocated to keep it as customer credit (advances / downpayments). Cash applied cannot exceed amount
        received. Unapplied: <strong>{formatPeso(unapplied)}</strong>
      </p>
      {e.allocations && (
        <div className="alert error" role="alert">
          {e.allocations}
        </div>
      )}
      {openBillings.length === 0 ? (
        <p className="faint">No open billings — the full amount will be kept as customer credit.</p>
      ) : (
        <div className="table-wrap">
          <table className="list">
            <thead>
              <tr>
                <th>Booklet</th>
                <th>Due</th>
                <th className="num">Balance</th>
                <th className="num">Cash</th>
                <th className="num">2307</th>
                <th>Rate</th>
                <th>ATC</th>
              </tr>
            </thead>
            <tbody>
              {openBillings.map((b, i) => (
                <tr key={b.id}>
                  <td>
                    <input type="hidden" name="allocBillingId" value={b.id} />
                    #{b.invoiceNo}
                    <div className="faint small">{b.number}</div>
                  </td>
                  <td>{b.dueDate}</td>
                  <td className="num">{formatPeso(b.balance)}</td>
                  <td>
                    <input
                      className="input"
                      name="allocCash"
                      value={allocs[i]?.cash ?? ""}
                      onChange={(ev) => {
                        const next = [...allocs];
                        next[i] = { ...next[i]!, cash: ev.target.value };
                        setAllocs(next);
                      }}
                      inputMode="decimal"
                      style={{ width: 100 }}
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      name="allocWithholding"
                      value={allocs[i]?.withholding ?? ""}
                      onChange={(ev) => {
                        const next = [...allocs];
                        next[i] = { ...next[i]!, withholding: ev.target.value };
                        setAllocs(next);
                      }}
                      inputMode="decimal"
                      style={{ width: 100 }}
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      name="allocRate"
                      value={allocs[i]?.rate ?? ""}
                      onChange={(ev) => {
                        const next = [...allocs];
                        next[i] = { ...next[i]!, rate: ev.target.value };
                        setAllocs(next);
                      }}
                      style={{ width: 80 }}
                      title="Prefill from SO; editable"
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      name="allocAtc"
                      value={allocs[i]?.atc ?? ""}
                      onChange={(ev) => {
                        const next = [...allocs];
                        next[i] = { ...next[i]!, atc: ev.target.value };
                        setAllocs(next);
                      }}
                      style={{ width: 80 }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="form-actions">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Record collection"}
        </button>
        <Link className="btn btn-secondary" href="/billing/collections">
          Cancel
        </Link>
      </div>
    </form>
  );
}
