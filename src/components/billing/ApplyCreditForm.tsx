"use client";

import { useMemo, useRef, useState } from "react";
import { applyCreditAction } from "@/app/(app)/billing/actions";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useFormAction } from "@/components/useFormAction";
import { formatPeso } from "@/lib/format";
import { fromScaled, toScaled } from "@/lib/quotes/calc";

export type ApplyCreditBillingOption = {
  id: string;
  label: string;
  balance: string;
};

/** min(credit, balance) with scaled-decimal math (no floats). */
function defaultAmount(credit: string, balance: string): string {
  try {
    const c = toScaled(credit, 2);
    const b = toScaled(balance, 2);
    if (c <= 0n || b <= 0n) return "0.00";
    return fromScaled(c < b ? c : b, 2);
  } catch {
    return "0.00";
  }
}

/**
 * Apply unapplied customer credit onto one open billing.
 * Shows available credit, defaults amount to min(credit, open balance),
 * confirms before submit, and surfaces actionable field errors.
 */
export function ApplyCreditForm({
  customerId,
  availableCredit,
  billings,
  lockedBillingId,
}: {
  customerId: string;
  availableCredit: string;
  billings: ApplyCreditBillingOption[];
  /** When set (billing detail page), billing is fixed. */
  lockedBillingId?: string;
}) {
  const { state, pending, submit } = useFormAction(applyCreditAction);
  const e = state.fieldErrors ?? {};
  const formRef = useRef<HTMLFormElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const initialBillingId = lockedBillingId ?? billings[0]?.id ?? "";
  const [billingId, setBillingId] = useState(initialBillingId);

  const selectedBalance = useMemo(() => {
    const row = billings.find((b) => b.id === billingId);
    return row?.balance ?? "0.00";
  }, [billings, billingId]);

  const [amount, setAmount] = useState(() => defaultAmount(availableCredit, selectedBalance));

  // When the selected billing changes (customer page), refresh the default amount.
  const onBillingChange = (id: string) => {
    setBillingId(id);
    const bal = billings.find((b) => b.id === id)?.balance ?? "0.00";
    setAmount(defaultAmount(availableCredit, bal));
  };

  const creditScaled = (() => {
    try {
      return toScaled(availableCredit, 2);
    } catch {
      return 0n;
    }
  })();
  const balanceScaled = (() => {
    try {
      return toScaled(selectedBalance, 2);
    } catch {
      return 0n;
    }
  })();

  if (creditScaled <= 0n) {
    return <p className="faint small">No customer credit to apply. Record a collection with unallocated cash first.</p>;
  }
  if (billings.length === 0 || (balanceScaled <= 0n && !lockedBillingId)) {
    return <p className="faint small">No open billing balance to apply credit against.</p>;
  }
  if (lockedBillingId && balanceScaled <= 0n) {
    return null;
  }

  const confirmBody = `Apply ₱${amount || "0.00"} of customer credit (available ₱${availableCredit}) to this billing’s open balance of ₱${selectedBalance}? This can’t be undone except by voiding the source collection.`;

  return (
    <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border, #ddd)" }}>
      <h2>Apply credit</h2>
      <p className="faint small">
        Available credit: <strong>{formatPeso(availableCredit)}</strong>
        {" · "}
        Open balance: <strong>{formatPeso(selectedBalance)}</strong>
      </p>
      <form
        ref={formRef}
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          setConfirmOpen(true);
        }}
      >
        {state.message && (
          <div className={`alert ${state.ok ? "ok" : "error"}`} role="status">
            {state.message}
          </div>
        )}
        {e.allocations && (
          <div className="alert error" role="alert">
            {e.allocations}
          </div>
        )}
        <input type="hidden" name="customerId" value={customerId} />
        <div className="form-grid">
          {lockedBillingId ? (
            <input type="hidden" name="billingId" value={lockedBillingId} />
          ) : (
            <div className={`field${e.billingId ? " has-error" : ""}`}>
              <label htmlFor="apply-credit-billing">Open billing</label>
              <select
                id="apply-credit-billing"
                name="billingId"
                value={billingId}
                onChange={(ev) => onBillingChange(ev.target.value)}
              >
                {billings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label} · balance {formatPeso(b.balance)}
                  </option>
                ))}
              </select>
              {e.billingId && <div className="error">{e.billingId}</div>}
            </div>
          )}
          <div className={`field${e.amount ? " has-error" : ""}`}>
            <label htmlFor="apply-credit-amount">Amount to apply</label>
            <input
              id="apply-credit-amount"
              name="amount"
              value={amount}
              onChange={(ev) => setAmount(ev.target.value)}
              inputMode="decimal"
            />
            <div className="hint">
              Defaults to the smaller of available credit and open balance ({formatPeso(defaultAmount(availableCredit, selectedBalance))}).
            </div>
            {e.amount && <div className="error">{e.amount}</div>}
          </div>
        </div>
        <div className="form-actions">
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Applying…" : "Apply credit"}
          </button>
        </div>
      </form>
      <ConfirmDialog
        open={confirmOpen}
        title="Apply customer credit?"
        body={confirmBody}
        confirmLabel="Apply credit"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          if (formRef.current) submit(formRef.current);
        }}
      />
    </div>
  );
}
