"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/docs/Dialogs";
import type { FormState } from "@/lib/validation/forms";
import { markStoreOrderProvisioningAction, refundStoreOrderAction } from "@/app/(app)/store-orders/actions";
import type { StoreOrderRefundKind } from "@/lib/store-orders/refund";

/**
 * Store-order fulfilment + mirror actions (store intake Slice 3):
 * "Mark provisioning" (edit_data) for a converted order, and the
 * refund / chargeback mirror dialog (manage_billing, reason required).
 * The mirror runs the existing void services in order and is resumable
 * — the dialog lists the steps still to void, so a stopped mirror is
 * finished by running it again.
 */
export function MarkProvisioningButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [state, setState] = useState<FormState>({});
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    const res = await markStoreOrderProvisioningAction(orderId);
    setPending(false);
    if (res.ok) router.refresh();
    else setState(res);
  }

  return (
    <>
      <button type="button" className="btn" onClick={onClick} disabled={pending}>
        {pending ? "Marking…" : "Mark provisioning"}
      </button>
      {state.message && !state.ok && (
        <div className="alert error" role="alert">
          {state.message}
        </div>
      )}
    </>
  );
}

export function RefundStoreOrderButtons({
  orderId,
  number,
  gatewayName,
  gatewayPaymentRef,
  pendingSteps,
}: {
  orderId: string;
  number: string;
  gatewayName: string;
  gatewayPaymentRef: string;
  /** "Collection CR-2026-0001" style labels for the steps not yet void. */
  pendingSteps: string[];
}) {
  const [kind, setKind] = useState<StoreOrderRefundKind | null>(null);
  return (
    <>
      <button type="button" className="btn" onClick={() => setKind("REFUNDED")}>
        Mark refunded
      </button>{" "}
      <button type="button" className="btn btn-danger" onClick={() => setKind("CHARGEBACK")}>
        Mark chargeback
      </button>
      {kind && (
        <RefundStoreOrderDialog
          orderId={orderId}
          number={number}
          gatewayName={gatewayName}
          gatewayPaymentRef={gatewayPaymentRef}
          pendingSteps={pendingSteps}
          kind={kind}
          onClose={() => setKind(null)}
        />
      )}
    </>
  );
}

function RefundStoreOrderDialog({
  orderId,
  number,
  gatewayName,
  gatewayPaymentRef,
  pendingSteps,
  kind,
  onClose,
}: {
  orderId: string;
  number: string;
  gatewayName: string;
  gatewayPaymentRef: string;
  pendingSteps: string[];
  kind: StoreOrderRefundKind;
  onClose: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [state, setState] = useState<FormState>({});
  const [pending, setPending] = useState(false);
  const e = state.fieldErrors ?? {};
  const isRefund = kind === "REFUNDED";

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (reason.trim().length < 3) {
      setState({ message: "Give a reason (at least 3 characters).", fieldErrors: { reason: "Give a reason (at least 3 characters)." } });
      return;
    }
    setPending(true);
    const res = await refundStoreOrderAction(orderId, { kind, reason: reason.trim() });
    setPending(false);
    if (res.ok) {
      onClose();
      router.refresh();
    } else {
      setState(res);
    }
  }

  return (
    <Modal
      title={`${isRefund ? "Mark refunded" : "Mark chargeback"} — ${number}?`}
      onClose={onClose}
      labelId="refund-store-order-title"
    >
      <p>
        This unwinds the converted documents in order — collection, billing, sales order, then the gateway fee
        expense — voiding each with the reason below. Steps already void are skipped, so if the sequence stops
        (for example a closed period) it can be run again to finish. The {gatewayName} payment (ref{" "}
        {gatewayPaymentRef}) stays recorded on the store order.
      </p>
      {pendingSteps.length > 0 ? (
        <p>
          Still to void: <b>{pendingSteps.join(", ")}</b>
        </p>
      ) : (
        <p>Every document in the chain is already void — this only records the terminal status.</p>
      )}
      <form onSubmit={submit}>
        {state.message && !state.ok && (
          <div className="alert error" role="alert">
            {state.message}
          </div>
        )}
        <div className="form-grid">
          <div className={`field full${e.reason ? " has-error" : ""}`}>
            <label htmlFor="refund-reason">Reason (required — recorded on every void)</label>
            <textarea
              id="refund-reason"
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
              rows={3}
              placeholder={isRefund ? "e.g. Buyer asked for a refund; gateway refund ref …" : "e.g. Chargeback raised by the bank; gateway case ref …"}
            />
            {e.reason && (
              <div className="error" role="alert">
                {e.reason}
              </div>
            )}
          </div>
        </div>
        <div className="buttons">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="btn btn-danger" disabled={pending}>
            {pending ? "Running…" : isRefund ? "Void all and mark refunded" : "Void all and mark chargeback"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
