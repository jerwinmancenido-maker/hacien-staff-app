"use client";

// "Create POs" preview on a sales order: lines grouped by supplier (one Draft PO
// per supplier), unit cost copied from the SO line. Lines without a supplier can
// get one here or are skipped; lines already on a PO are shown but locked.

import { useState } from "react";
import Link from "next/link";
import { useFormAction } from "@/components/useFormAction";
import { formatPeso } from "@/lib/format";
import { fromScaled, lineAmounts, toScaled, type ItemKind } from "@/lib/quotes/calc";
import { planPurchaseOrders } from "@/lib/purchasing/plan";
import type { FormState } from "@/lib/validation/forms";

export type PreviewLine = {
  id: string;
  sortOrder: number;
  description: string;
  kind: ItemKind;
  qty: string;
  unit: string;
  supplierId: string | null;
  supplierName: string | null;
  supplierUnitCost: string;
  purchaseOrder: { id: string; number: string } | null;
};

const qty = (q: string) => q.replace(/\.00$/, "");
const total = (q: string, c: string) => lineAmounts({ kind: "GOODS", qty: q, unitPrice: c, supplierUnitCost: "0" }).total;

export function CreatePosForm({
  lines,
  suppliers,
  defaultDate,
  defaultAddress,
  action,
  cancelHref,
}: {
  lines: PreviewLine[];
  suppliers: { id: string; name: string }[];
  defaultDate: string;
  defaultAddress: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  cancelHref: string;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [h, setH] = useState({ date: defaultDate, expectedDate: "", deliveryAddressText: defaultAddress });
  const names = new Map([...suppliers.map((s) => [s.id, s.name] as const), ...lines.flatMap((l) => (l.supplierId && l.supplierName ? [[l.supplierId, l.supplierName] as const] : []))]);

  const ordered = new Set(lines.filter((l) => l.purchaseOrder).map((l) => l.id));
  const include = new Set(lines.filter((l) => !skip.has(l.id)).map((l) => l.id));
  const plan = planPurchaseOrders(lines, ordered, picks, include);
  const e = state.fieldErrors ?? {};
  const payload = { ...h, supplierPicks: picks, lineIds: [...include] };

  return (
    <form onSubmit={onSubmit} noValidate>
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      {state.message && (
        <div className={`alert ${state.ok ? "ok" : "error"}`} role="alert">
          {state.message}
        </div>
      )}
      <div className="card">
        <h2>For all new POs</h2>
        <div className="form-grid">
          <div className={`field${e.date ? " has-error" : ""}`}>
            <label htmlFor="date">PO date</label>
            <input id="date" type="date" className="input" value={h.date} onChange={(ev) => setH({ ...h, date: ev.target.value })} />
            {e.date && <div className="error">{e.date}</div>}
          </div>
          <div className={`field${e.expectedDate ? " has-error" : ""}`}>
            <label htmlFor="expectedDate">Expected delivery</label>
            <input id="expectedDate" type="date" className="input" value={h.expectedDate} onChange={(ev) => setH({ ...h, expectedDate: ev.target.value })} />
            {e.expectedDate && <div className="error">{e.expectedDate}</div>}
          </div>
          <div className="field full">
            <label htmlFor="deliveryAddressText">Deliver to</label>
            <textarea id="deliveryAddressText" rows={3} value={h.deliveryAddressText} onChange={(ev) => setH({ ...h, deliveryAddressText: ev.target.value })} />
            <div className="hint">From the sales order&apos;s delivery address. You can change it on each PO later.</div>
          </div>
        </div>
      </div>

      {plan.pos.map((po, n) => {
        const sum = fromScaled(
          po.lines.reduce((a, l) => a + toScaled(total(l.qty, l.unitCost), 2), 0n),
          2,
        );
        return (
          <div className="card" key={po.supplierId} aria-label={`New PO ${n + 1}`}>
            <div className="card-head">
              <h2>
                PO {n + 1} · {names.get(po.supplierId) ?? "Supplier"}
              </h2>
              <div className="right small muted">
                {po.lines.length} line{po.lines.length === 1 ? "" : "s"} · <b>{formatPeso(sum)}</b>
              </div>
            </div>
            <div className="table-wrap">
              <table className="list">
                <thead>
                  <tr>
                    <th aria-label="Include" />
                    <th>Description</th>
                    <th className="num">Qty</th>
                    <th>Unit</th>
                    <th className="num">Unit cost</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {po.lines.map((l) => (
                    <tr key={l.salesOrderItemId}>
                      <td>
                        <input type="checkbox" checked aria-label={`Include ${l.description}`} onChange={() => setSkip(new Set(skip).add(l.salesOrderItemId))} />
                      </td>
                      <td style={{ whiteSpace: "pre-wrap" }}>{l.description}</td>
                      <td className="num">{qty(l.qty)}</td>
                      <td>{l.unit}</td>
                      <td className="num">{formatPeso(l.unitCost)}</td>
                      <td className="num strong">{formatPeso(total(l.qty, l.unitCost))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {plan.needsSupplier.length > 0 && (
        <div className="card">
          <h2>Needs a supplier</h2>
          <p className="small muted">These lines have no supplier on the sales order. Pick one to include them, or they&apos;re skipped.</p>
          <div className="table-wrap">
            <table className="list">
              <tbody>
                {plan.needsSupplier.map((l) => (
                  <tr key={l.id}>
                    <td style={{ whiteSpace: "pre-wrap" }}>{l.description}</td>
                    <td className="num">
                      {qty(l.qty)} {l.unit}
                    </td>
                    <td>
                      <select aria-label={`Supplier for ${l.description}`} value={picks[l.id] ?? ""} onChange={(ev) => setPicks({ ...picks, [l.id]: ev.target.value })}>
                        <option value="">Skip (no supplier)</option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(skip.size > 0 || plan.alreadyOrdered.length > 0) && (
        <div className="card">
          <h2>Not included</h2>
          <div className="table-wrap">
            <table className="list">
              <tbody>
                {lines
                  .filter((l) => l.purchaseOrder || skip.has(l.id))
                  .map((l) => (
                    <tr key={l.id} className="inactive">
                      <td style={{ whiteSpace: "pre-wrap" }}>{l.description}</td>
                      <td className="num">
                        {qty(l.qty)} {l.unit}
                      </td>
                      <td>
                        {l.purchaseOrder ? (
                          <>
                            Already on <Link href={`/purchase-orders/${l.purchaseOrder.id}`}>{l.purchaseOrder.number}</Link>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn-link small"
                            onClick={() => {
                              const next = new Set(skip);
                              next.delete(l.id);
                              setSkip(next);
                            }}
                          >
                            Include again
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="form-actions">
        <button className="btn" type="submit" disabled={pending || plan.pos.length === 0}>
          {pending ? "Creating…" : `Create ${plan.pos.length} draft PO${plan.pos.length === 1 ? "" : "s"}`}
        </button>
        <a className="btn btn-secondary" href={cancelHref}>
          Cancel
        </a>
      </div>
    </form>
  );
}
