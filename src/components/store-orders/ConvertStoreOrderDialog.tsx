"use client";

import { useState } from "react";
import { Modal } from "@/components/docs/Dialogs";
import { formatPeso } from "@/lib/format";
import type { FormState } from "@/lib/validation/forms";
import type { StoreOrderConversionPrep } from "@/lib/store-orders/views";
import type { ConvertStoreOrderInput } from "@/lib/store-orders/convert";
import { convertStoreOrderAction } from "@/app/(app)/store-orders/actions";
import { SearchPicker } from "@/components/SearchPicker";

type CustomerOption = { id: string; name: string };
type ItemOption = { id: string; name: string; sku: string | null };

/**
 * Conversion dialog (store intake Slice 2): staff confirm the customer
 * (proposal / pick / create), resolve flagged lines, and type the
 * booklet SI number. One click runs the whole conversion transaction —
 * SO + billing + collection — and lands on the new sales order.
 */
export function ConvertStoreOrderButton({
  prep,
  customers,
  items,
}: {
  prep: StoreOrderConversionPrep;
  customers: CustomerOption[];
  items: ItemOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Convert to sales order
      </button>
      {open && <ConvertStoreOrderDialog prep={prep} customers={customers} items={items} onClose={() => setOpen(false)} />}
    </>
  );
}

function ConvertStoreOrderDialog({
  prep,
  customers,
  items,
  onClose,
}: {
  prep: StoreOrderConversionPrep;
  customers: CustomerOption[];
  items: ItemOption[];
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"matched" | "existing" | "new">(prep.matchedCustomer ? "matched" : "new");
  const [customerId, setCustomerId] = useState("");
  const [isIndividual, setIsIndividual] = useState(false);
  const [si, setSi] = useState(prep.nextSi != null ? String(prep.nextSi) : "");
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [state, setState] = useState<FormState>({});
  const [pending, setPending] = useState(false);
  const e = state.fieldErrors ?? {};

  const unresolved = prep.lines.filter((l) => l.needsPick && !picks[l.id]);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (mode === "existing" && !customerId) {
      setState({ message: "Pick the customer for this order.", fieldErrors: { customerId: "Pick the customer for this order." } });
      return;
    }
    if (unresolved.length) {
      setState({
        message: `Resolve the catalogue match for ${unresolved.map((l) => `“${l.title}”`).join(", ")} — pick an item or keep it as free text.`,
        fieldErrors: { lineItemPicks: "Resolve every flagged line." },
      });
      return;
    }
    const invoiceNo = Number(si);
    if (!Number.isInteger(invoiceNo) || invoiceNo <= 0) {
      setState({ message: "Enter the booklet SI number.", fieldErrors: { invoiceNo: "Enter the booklet SI number." } });
      return;
    }
    const lineItemPicks: Record<string, string | null> = {};
    for (const l of prep.lines) {
      if (!l.needsPick) continue;
      lineItemPicks[l.id] = picks[l.id] === "freetext" ? null : (picks[l.id] ?? null);
    }
    const input: ConvertStoreOrderInput = {
      customerMode: mode,
      customerId: mode === "existing" ? customerId : null,
      isIndividual: mode === "new" ? isIndividual : undefined,
      invoiceNo,
      lineItemPicks,
    };
    setPending(true);
    const res = await convertStoreOrderAction(prep.orderId, input);
    setPending(false);
    if (!res.ok) setState(res);
  }

  return (
    <Modal title={`Convert ${prep.number} to a sales order?`} onClose={onClose} labelId="convert-store-order-title">
      <p>
        Creates the sales order, the billing and the collection for {formatPeso(prep.amountPaid)} in one step. The
        verified {prep.gatewayName} payment (ref {prep.gatewayPaymentRef}) is the acceptance evidence — it is recorded
        on the sales order.
      </p>
      <form onSubmit={submit}>
        {state.message && !state.ok && (
          <div className="alert error" role="alert">
            {state.message}
          </div>
        )}

        <div className="form-grid">
          <div className={`field full${e.customerId ? " has-error" : ""}`}>
            <label>Customer</label>
            {prep.matchedCustomer && (
              <label style={{ display: "block", fontWeight: "normal" }}>
                <input type="radio" name="customerMode" checked={mode === "matched"} onChange={() => setMode("matched")} /> Use
                the proposed match: <b>{prep.matchedCustomer.name}</b>
              </label>
            )}
            <label style={{ display: "block", fontWeight: "normal" }}>
              <input type="radio" name="customerMode" checked={mode === "existing"} onChange={() => setMode("existing")} /> Pick
              an existing customer
            </label>
            {mode === "existing" && (
              <SearchPicker
                ariaLabel="Customer"
                value={customerId}
                options={customers.map((c) => ({ id: c.id, label: c.name }))}
                placeholder="Pick a customer…"
                emptyOptionLabel="Pick a customer…"
                onPick={setCustomerId}
              />
            )}
            <label style={{ display: "block", fontWeight: "normal" }}>
              <input type="radio" name="customerMode" checked={mode === "new"} onChange={() => setMode("new")} /> Create a
              new customer from the buyer details
            </label>
            {mode === "new" && (
              <label style={{ display: "block", fontWeight: "normal" }}>
                <input type="checkbox" checked={isIndividual} onChange={(ev) => setIsIndividual(ev.target.checked)} /> The
                buyer is an individual (not a company)
              </label>
            )}
            {e.customerId && <div className="error">{e.customerId}</div>}
            <div className="hint">The buyer&apos;s contact and delivery address are saved under the customer.</div>
          </div>

          {prep.lines.some((l) => l.needsPick || l.costPreview || prep.linesWithoutCost.includes(l.title)) && (
            <div className={`field full${e.lineItemPicks ? " has-error" : ""}`}>
              <label>Lines</label>
              {prep.lines.map((l) => (
                <div key={l.id} style={{ marginBottom: 8 }}>
                  <div>
                    {l.title} — {l.qty} × {formatPeso(l.unitPrice)} = {formatPeso(l.lineTotal)}
                  </div>
                  {l.mappedItemName && (
                    <div className="hint">
                      Catalogue: {l.mappedItemName}
                      {l.costPreview
                        ? ` · last cost ${formatPeso(l.costPreview.unitCost)} (${l.costPreview.supplierName})`
                        : " · no cost history — converts at cost 0"}
                    </div>
                  )}
                  {l.needsPick && (
                    <SearchPicker
                      ariaLabel={`Resolve line ${l.title}`}
                      value={picks[l.id] ?? ""}
                      options={[
                        { id: "freetext", label: "Keep as free text (title as sent)" },
                        ...items.map((it) => ({ id: it.id, label: `Use item: ${it.name}`, meta: it.sku ?? undefined })),
                      ]}
                      placeholder="Resolve this line…"
                      emptyOptionLabel="Resolve this line…"
                      onPick={(id) => setPicks((p) => ({ ...p, [l.id]: id }))}
                    />
                  )}
                </div>
              ))}
              {e.lineItemPicks && <div className="error">{e.lineItemPicks}</div>}
            </div>
          )}

          <div className={`field${e.invoiceNo ? " has-error" : ""}`}>
            <label htmlFor="storeSi">
              Sales invoice no. (booklet) <span className="req">*</span>
            </label>
            <input
              id="storeSi"
              type="number"
              inputMode="numeric"
              value={si}
              onChange={(ev) => setSi(ev.target.value)}
              required
            />
            {e.invoiceNo && <div className="error">{e.invoiceNo}</div>}
            <div className="hint">
              Booklet range {prep.siRange.from}–{prep.siRange.to}. Pre-filled with the lowest unclaimed number — check it
              against the physical booklet. It is claimed only when you convert.
            </div>
          </div>

          <div className="field">
            <label>Figures</label>
            <div className="hint">
              Amount paid {formatPeso(prep.amountPaid)} (delivery fee {formatPeso(prep.deliveryFee)} included as an order
              line). Gateway fee {formatPeso(prep.gatewayFee)} is recorded on the order as data — never on a customer
              document.
              {prep.marginPreviewPct != null
                ? ` Estimated margin ≈ ${prep.marginPreviewPct}% from last PO costs — informational only.`
                : prep.linesWithoutCost.length
                  ? ` No cost history for: ${prep.linesWithoutCost.join(", ")} — those lines convert at cost 0.`
                  : ""}
            </div>
          </div>
        </div>

        <div className="buttons">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={pending}>
            {pending ? "Converting…" : "Convert to SO"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
