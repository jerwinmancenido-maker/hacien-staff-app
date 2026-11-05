"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import { NoIdUploadWarning } from "@/components/NoIdUploadWarning";
import type { FormState } from "@/lib/validation/forms";
import { COLLECTION_METHODS, COLLECTION_METHOD_LABELS } from "@/lib/validation/billing";
import { formatPeso } from "@/lib/format";
import { ratePctLabel } from "@/lib/quotes/calc";
import { CashAccountSelect, type CashAccountOption } from "@/components/cash/CashAccountSelect";

export type PrefillCode = { rate: string; atcCode: string | null; amount?: string };

export type OpenBillingRow = {
  id: string;
  invoiceNo: number;
  number: string;
  dueDate: string;
  amount: string;
  balance: string;
  defaultRate: string;
  defaultAtc: string | null;
  /** Prefill from SO lines / snapshot — one entry per ATC. */
  defaultCodes: PrefillCode[];
};

type AllocState = {
  billingId: string;
  cash: string;
  withholding: string;
  rate: string;
  atc: string;
  codes: { rate: string; atc: string; amount: string }[];
};

function codesForBilling(b: OpenBillingRow): AllocState["codes"] {
  if (b.defaultCodes.length > 0) {
    return b.defaultCodes.map((c) => ({
      rate: c.rate,
      atc: c.atcCode ?? "",
      amount: c.amount ?? "",
    }));
  }
  return [{ rate: b.defaultRate, atc: b.defaultAtc ?? "", amount: "" }];
}

/**
 * Cash take + 2307 split for a given amount received, oldest billing first.
 * The cash take reserves room for the prefilled withholding, or the auto-fill
 * would eat the whole balance in cash and the split could never apply.
 * Prefilled 2307 amounts only apply to a full settlement of the billing
 * (cash taken + withholding = remaining balance). On a partial collection the
 * withholding is staff's call, so the split stays blank instead of posting
 * the full remaining split.
 */
function computeAlloc(openBillings: OpenBillingRow[], received: number): AllocState[] {
  const { rows } = openBillings.reduce<{ left: number; rows: AllocState[] }>(
    (acc, b) => {
      const bal = Number(b.balance);
      const codes = codesForBilling(b);
      const whSum = codes.reduce((a, c) => a + (Number(c.amount) || 0), 0);
      const reserve = whSum > 0 ? Math.max(0, bal - whSum) : bal;
      const take = acc.left > 0 ? Math.min(reserve, acc.left) : 0;
      const fullSettlement =
        take > 0 && Math.round(take * 100) + Math.round(whSum * 100) === Math.round(bal * 100);
      return {
        left: acc.left - take,
        rows: [
          ...acc.rows,
          {
            billingId: b.id,
            cash: take > 0 ? take.toFixed(2) : "",
            withholding: fullSettlement && whSum > 0 ? whSum.toFixed(2) : "",
            rate: b.defaultRate,
            atc: b.defaultAtc ?? "",
            codes: fullSettlement ? codes : codes.map((c) => ({ ...c, amount: "" })),
          },
        ],
      };
    },
    { left: received, rows: [] },
  );
  return rows;
}

export function CollectionForm({
  action,
  customerId,
  customerName,
  defaults,
  openBillings,
  cashAccounts = [],
  cashEnabled = false,
  canEdit,
  canOverrideRates = false,
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
  /** Admin only — Staff cannot type a custom rate/ATC. */
  canOverrideRates?: boolean;
}) {
  const { state, pending, submit } = useFormAction(action);
  const e = state.fieldErrors ?? {};
  const [method, setMethod] = useState(defaults.method || "CASH");
  const [amount, setAmount] = useState(defaults.amountReceived);
  // Billings staff already edited by hand — the amount-driven auto-fill must
  // never overwrite their values.
  const [touched, setTouched] = useState<ReadonlySet<number>>(new Set());

  const initialAlloc = useMemo(
    () => computeAlloc(openBillings, Number(defaults.amountReceived) || 0),
    [openBillings, defaults.amountReceived],
  );

  const [allocs, setAllocs] = useState(initialAlloc);

  function markTouched(i: number) {
    setTouched((prev) => (prev.has(i) ? prev : new Set(prev).add(i)));
  }

  // The form mounts with an empty amount (staff type it after the page loads),
  // so the mount-time allocation can never know the cash take — the 2307 split
  // has to follow the typed amount instead. When the amount changes, auto-fill
  // cash and the split for billings the amount fully settles; rows staff
  // edited by hand keep their values.
  function onAmountChange(value: string) {
    setAmount(value);
    const fresh = computeAlloc(openBillings, Number(value) || 0);
    setAllocs((prev) => prev.map((row, i) => (touched.has(i) ? row : fresh[i]!)));
  }

  if (!canEdit) return <p className="faint">You can view collections but not record them.</p>;

  const cashSum = allocs.reduce((a, x) => a + (Number(x.cash) || 0), 0);
  const unapplied = Math.max(0, (Number(amount) || 0) - cashSum);

  function setCodeAmount(billingIndex: number, codeIndex: number, value: string) {
    markTouched(billingIndex);
    const next = [...allocs];
    const row = { ...next[billingIndex]! };
    const codes = [...row.codes];
    codes[codeIndex] = { ...codes[codeIndex]!, amount: value };
    const whTotal = codes.reduce((a, c) => a + (Number(c.amount) || 0), 0);
    row.codes = codes;
    row.withholding = whTotal > 0 ? whTotal.toFixed(2) : "";
    next[billingIndex] = row;
    setAllocs(next);
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
            onChange={(ev) => onAmountChange(ev.target.value)}
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
          <NoIdUploadWarning />
          {e.files && <div className="error">{e.files}</div>}
        </div>
      </div>

      <h3 className="section-title" style={{ marginTop: 24 }}>
        Allocate to open billings
      </h3>
      <p className="faint small">
        Leave cash unallocated to keep it as customer credit (advances / downpayments). Cash applied cannot exceed amount
        received. Unapplied: <strong>{formatPeso(unapplied)}</strong> The 2307 split fills in automatically once the amount
        fully covers a billing — clear it if the customer withheld less.
        {!canOverrideRates ? " Rates come from the sales order — only an Admin can override." : ""}
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
                <th className="num">2307 total</th>
                <th>ATC codes</th>
              </tr>
            </thead>
            <tbody>
              {openBillings.map((b, i) => (
                <tr key={b.id}>
                  <td>
                    <input type="hidden" name="allocBillingId" value={b.id} />
                    <input type="hidden" name="allocWithholding" value={allocs[i]?.withholding ?? ""} />
                    <input type="hidden" name="allocRate" value={allocs[i]?.rate ?? ""} />
                    <input type="hidden" name="allocAtc" value={allocs[i]?.atc ?? ""} />
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
                        markTouched(i);
                        const next = [...allocs];
                        next[i] = { ...next[i]!, cash: ev.target.value };
                        setAllocs(next);
                      }}
                      inputMode="decimal"
                      style={{ width: 100 }}
                    />
                  </td>
                  <td className="num">{allocs[i]?.withholding ? formatPeso(allocs[i]!.withholding) : "—"}</td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {(allocs[i]?.codes ?? []).map((code, ci) => (
                        <div key={`${b.id}-${ci}`} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          <input type="hidden" name="allocCodeBillingId" value={b.id} />
                          <input type="hidden" name="allocCodeRate" value={code.rate} />
                          <input type="hidden" name="allocCodeAtc" value={code.atc} />
                          <span className="small">
                            {code.atc || "—"} · {ratePctLabel(Number(code.rate).toFixed(4))}
                          </span>
                          {canOverrideRates ? (
                            <>
                              <input
                                className="input"
                                value={code.rate}
                                onChange={(ev) => {
                                  markTouched(i);
                                  const next = [...allocs];
                                  const codes = [...next[i]!.codes];
                                  codes[ci] = { ...codes[ci]!, rate: ev.target.value };
                                  next[i] = { ...next[i]!, codes, rate: codes[0]?.rate ?? next[i]!.rate };
                                  setAllocs(next);
                                }}
                                style={{ width: 72 }}
                                title="Rate fraction (Admin)"
                              />
                              <input
                                className="input"
                                value={code.atc}
                                onChange={(ev) => {
                                  markTouched(i);
                                  const next = [...allocs];
                                  const codes = [...next[i]!.codes];
                                  codes[ci] = { ...codes[ci]!, atc: ev.target.value };
                                  next[i] = { ...next[i]!, codes, atc: codes[0]?.atc ?? next[i]!.atc };
                                  setAllocs(next);
                                }}
                                style={{ width: 72 }}
                                title="ATC (Admin)"
                              />
                            </>
                          ) : null}
                          <input
                            className="input"
                            name="allocCodeAmount"
                            value={code.amount}
                            onChange={(ev) => setCodeAmount(i, ci, ev.target.value)}
                            inputMode="decimal"
                            style={{ width: 100 }}
                            placeholder="Amount"
                            aria-label={`2307 amount for ${code.atc || "code"}`}
                          />
                        </div>
                      ))}
                    </div>
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
