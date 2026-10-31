"use client";

// Editor for quotes (new / edit) and sales orders (edit): header fields,
// item lines and a live totals box. Totals here are a preview; the server
// recomputes and stores them on save (src/lib/quotes/calc.ts).
//
// Cost fields (supplier, supplier unit cost, margins) only exist when the
// server says the user can see costs; otherwise they're never rendered or sent.
//
// Line withholding defaults come from the customer's withholding type + kind.
// Staff can override a line (flag + note). "Re-apply customer's withholding"
// refreshes non-override lines from the customer's current type; lines with
// withholdingOverride=true are left alone.
//
// Expected withholding = sum of (each line's total × that line's rate), rounded
// per line to the centavo. The document-level withholding summary is read-only.

import { useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import {
  docTotals,
  lineAmounts,
  ratePctLabel,
  toScaled,
  withholdingSnapshotFromLines,
  type ItemKind,
  type WithholdingSnapshot,
} from "@/lib/quotes/calc";
import {
  lineDiffersFromUsual,
  lineWithholdingSnapshot,
  MISSING_WITHHOLDING_TYPE_WARNING,
  needsWithholdingTypeWarning,
  OVERRIDE_NOTE,
  REAPPLY_WITHHOLDING_LABEL,
  allowGovVatOption,
  GOV_ATC_CODE_TO_CONFIRM,
  isUnverifiedGovAtc,
  WITHHOLDING_DEFAULT_CODES,
} from "@/lib/quotes/withholding-defaults";
import { formatPeso } from "@/lib/format";
import type { FormState } from "@/lib/validation/forms";
import { TotalsBox } from "./DocParts";

export type EditorCustomer = {
  id: string;
  name: string;
  address: string | null;
  defaultTerms: string | null;
  withholdingType: string;
  contacts: { id: string; name: string; isMain: boolean }[];
};

export type EditorItem = {
  key: string;
  id: string | null;
  description: string;
  kind: ItemKind;
  qty: string;
  unit: string;
  unitPrice: string;
  supplierId: string | null;
  supplierUnitCost: string;
  withholdingRate: string | null;
  withholdingAtc: string | null;
  withholdingOverride: boolean;
};

export type EditorInitial = {
  customerId: string;
  contactId: string;
  date: string;
  validUntil: string;
  terms: string;
  notes: string;
  withholdingCodes: string[];
  buyerPoNo: string;
  buyerPoDate: string;
  deliveryAddress: string;
  items: Omit<EditorItem, "key">[];
};

type Props = {
  mode: "quote" | "salesOrder";
  isNew: boolean;
  initial: EditorInitial;
  customers: EditorCustomer[];
  /** Rates that can be picked (active ones plus any already on the document, with their snapshotted values). */
  rates: WithholdingSnapshot[];
  /** Suppliers for the item lines; only passed to users who can see costs. */
  suppliers: { id: string; name: string }[] | null;
  termsOptions: string[];
  action: (state: FormState, form: FormData) => Promise<FormState>;
  cancelHref: string;
};

let seq = 0;
const newKey = () => `n${++seq}`;

function blankItem(customerType: string | null | undefined): EditorItem {
  const wh = lineWithholdingSnapshot(customerType, "GOODS");
  return {
    key: newKey(),
    id: null,
    description: "",
    kind: "GOODS",
    qty: "1",
    unit: "pc",
    unitPrice: "",
    supplierId: null,
    supplierUnitCost: "",
    withholdingRate: wh.withholdingRate,
    withholdingAtc: wh.withholdingAtc,
    withholdingOverride: false,
  };
}

function safeLine(i: EditorItem) {
  try {
    return lineAmounts({ kind: i.kind, qty: i.qty || "0", unitPrice: i.unitPrice || "0", supplierUnitCost: i.supplierUnitCost || "0" });
  } catch {
    return { total: "0.00", supplierTotal: "0.00", margin: "0.00" };
  }
}

function visibleRates(rates: WithholdingSnapshot[]): WithholdingSnapshot[] {
  if (allowGovVatOption()) return rates;
  return rates.filter((r) => r.code !== WITHHOLDING_DEFAULT_CODES.GOV_VAT_5);
}

export function DocumentEditor({ mode, isNew, initial, customers, rates: allRates, suppliers, termsOptions, action, cancelHref }: Props) {
  const { state, pending, onSubmit } = useFormAction(action);
  const withCosts = suppliers !== null;
  const rates = visibleRates(allRates);
  const [h, setH] = useState(() => ({
    ...initial,
    withholdingCodes: initial.withholdingCodes.filter((c) => c !== WITHHOLDING_DEFAULT_CODES.GOV_VAT_5 || allowGovVatOption()),
  }));
  const [items, setItems] = useState<EditorItem[]>(() =>
    initial.items.length
      ? initial.items.map((i) => ({
          ...i,
          key: newKey(),
          // Keep null as null — "not snapshotted yet" must not look like an override.
          withholdingRate: i.withholdingRate,
          withholdingAtc: i.withholdingAtc ?? null,
          withholdingOverride: i.withholdingOverride ?? false,
        }))
      : [blankItem(customers.find((c) => c.id === initial.customerId)?.withholdingType)],
  );
  const [reapplyWithholding, setReapplyWithholding] = useState(false);
  const e = state.fieldErrors ?? {};
  const customer = customers.find((c) => c.id === h.customerId);
  const contacts = customer?.contacts ?? [];
  const terms = h.terms && !termsOptions.includes(h.terms) ? [...termsOptions, h.terms] : termsOptions;
  const typeWarning = customer ? needsWithholdingTypeWarning(customer.withholdingType) : false;

  const lineInputs = items.map((i) => {
    const a = safeLine(i);
    return {
      kind: i.kind,
      total: a.total,
      supplierTotal: a.supplierTotal,
      margin: a.margin,
      withholdingRate: i.withholdingRate,
      withholdingAtc: i.withholdingAtc,
    };
  });
  const t = docTotals(lineInputs);
  const totals = { ...t, withholding: t.withholding.map((w) => ({ ...w, pctLabel: ratePctLabel(w.rate) })) };
  const computedDocRates = withholdingSnapshotFromLines(lineInputs);

  const setItem = (key: string, patch: Partial<EditorItem>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const move = (idx: number, by: number) =>
    setItems((xs) => {
      const next = [...xs];
      const [it] = next.splice(idx, 1);
      next.splice(Math.max(0, Math.min(next.length, idx + by)), 0, it!);
      return next;
    });

  /**
   * Refresh lines from the customer type.
   * When `skipOverrides` is true (Re-apply button), lines with
   * withholdingOverride=true keep their rate/ATC/flag.
   */
  function applyCustomerDefaults(
    type: string | null | undefined,
    nextItems: EditorItem[],
    headerPatch: Partial<typeof h> = {},
    opts: { skipOverrides?: boolean } = {},
  ) {
    const refreshed = nextItems.map((i) => {
      if (opts.skipOverrides && i.withholdingOverride) return i;
      const wh = lineWithholdingSnapshot(type, i.kind);
      return { ...i, withholdingRate: wh.withholdingRate, withholdingAtc: wh.withholdingAtc, withholdingOverride: false };
    });
    setItems(refreshed);
    const codes = withholdingSnapshotFromLines(
      refreshed.map((i) => {
        const a = safeLine(i);
        return { kind: i.kind, total: a.total, supplierTotal: a.supplierTotal, margin: a.margin, withholdingRate: i.withholdingRate, withholdingAtc: i.withholdingAtc };
      }),
    ).map((w) => w.code);
    setH((v) => ({ ...v, ...headerPatch, withholdingCodes: codes }));
    setReapplyWithholding(true);
  }

  function pickCustomer(id: string) {
    const c = customers.find((x) => x.id === id);
    // Changing customer resets every line (including prior overrides).
    applyCustomerDefaults(c?.withholdingType, items, {
      customerId: id,
      contactId: c?.contacts.find((k) => k.isMain)?.id ?? "",
      terms: c?.defaultTerms ?? h.terms,
    });
  }

  function changeKind(key: string, kind: ItemKind) {
    setItems((xs) =>
      xs.map((x) => {
        if (x.key !== key) return x;
        if (x.withholdingOverride) return { ...x, kind };
        const wh = lineWithholdingSnapshot(customer?.withholdingType, kind);
        return { ...x, kind, withholdingRate: wh.withholdingRate, withholdingAtc: wh.withholdingAtc, withholdingOverride: false };
      }),
    );
  }

  function changeLineWithholding(key: string, patch: { withholdingRate?: string | null; withholdingAtc?: string | null }) {
    setItems((xs) =>
      xs.map((x) => {
        if (x.key !== key) return x;
        const next = { ...x, ...patch };
        const differs = lineDiffersFromUsual(customer?.withholdingType, next.kind, { rate: next.withholdingRate, atc: next.withholdingAtc });
        return { ...next, withholdingOverride: differs };
      }),
    );
  }

  const payload =
    mode === "quote"
      ? {
          customerId: h.customerId,
          contactId: h.contactId || null,
          date: h.date,
          validUntil: h.validUntil,
          terms: h.terms,
          notes: h.notes,
          withholdingCodes: computedDocRates.map((w) => w.code),
          reapplyWithholding: reapplyWithholding || undefined,
          items: items.map(itemPayload),
        }
      : {
          contactId: h.contactId || null,
          buyerPoNo: h.buyerPoNo,
          buyerPoDate: h.buyerPoDate,
          deliveryAddress: h.deliveryAddress,
          terms: h.terms,
          notes: h.notes,
          reapplyWithholding: reapplyWithholding || undefined,
          items: items.map(itemPayload),
        };

  function itemPayload(i: EditorItem) {
    const base = {
      id: i.id,
      description: i.description,
      kind: i.kind,
      qty: i.qty,
      unit: i.unit,
      unitPrice: i.unitPrice,
      withholdingRate: i.withholdingRate,
      withholdingAtc: i.withholdingAtc,
      withholdingOverride: i.withholdingOverride,
    };
    return withCosts ? { ...base, supplierId: i.supplierId, supplierUnitCost: i.supplierUnitCost || "0" } : base;
  }

  const itemErrors = Object.entries(e).filter(([k]) => k.startsWith("items"));

  return (
    <form onSubmit={onSubmit} noValidate>
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      {state.message && (
        <div className={`alert ${state.ok ? "ok" : "error"}`} role="status">
          {state.message}
        </div>
      )}

      {typeWarning && (
        <div className="alert warn" role="alert">
          {MISSING_WITHHOLDING_TYPE_WARNING}
        </div>
      )}

      <div className="card">
        <h2>{mode === "quote" ? "Quote details" : "Order details"}</h2>
        <div className="form-grid">
          {mode === "quote" ? (
            <div className={`field${e.customerId ? " has-error" : ""}`}>
              <label htmlFor="customerId">
                Customer<span className="req"> *</span>
              </label>
              <select id="customerId" value={h.customerId} onChange={(ev) => pickCustomer(ev.target.value)}>
                <option value="">Pick a customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {e.customerId && <div className="error">{e.customerId}</div>}
            </div>
          ) : (
            <div className="field">
              <span className="label">Customer</span>
              <div className="strong" style={{ padding: "8px 0" }}>
                {customer?.name}
              </div>
            </div>
          )}
          <div className={`field${e.contactId ? " has-error" : ""}`}>
            <label htmlFor="contactId">Contact</label>
            <select id="contactId" value={h.contactId} onChange={(ev) => setH({ ...h, contactId: ev.target.value })} disabled={!customer}>
              <option value="">None</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.isMain ? " (main)" : ""}
                </option>
              ))}
            </select>
            {e.contactId && <div className="error">{e.contactId}</div>}
          </div>
          {mode === "quote" ? (
            <>
              <div className={`field${e.date ? " has-error" : ""}`}>
                <label htmlFor="date">
                  Date<span className="req"> *</span>
                </label>
                <input id="date" type="date" className="input" value={h.date} onChange={(ev) => setH({ ...h, date: ev.target.value })} />
                {e.date ? <div className="error">{e.date}</div> : isNew && <div className="hint">The number (QT-year-####) is given when you save.</div>}
              </div>
              <div className={`field${e.validUntil ? " has-error" : ""}`}>
                <label htmlFor="validUntil">Valid until</label>
                <input id="validUntil" type="date" className="input" value={h.validUntil} onChange={(ev) => setH({ ...h, validUntil: ev.target.value })} />
                {e.validUntil ? <div className="error">{e.validUntil}</div> : <div className="hint">Defaults from Settings → Quote defaults.</div>}
              </div>
            </>
          ) : (
            <>
              <div className={`field${e.buyerPoNo ? " has-error" : ""}`}>
                <label htmlFor="buyerPoNo">Buyer PO no.</label>
                <input id="buyerPoNo" type="text" value={h.buyerPoNo} onChange={(ev) => setH({ ...h, buyerPoNo: ev.target.value })} />
                {e.buyerPoNo && <div className="error">{e.buyerPoNo}</div>}
              </div>
              <div className={`field${e.buyerPoDate ? " has-error" : ""}`}>
                <label htmlFor="buyerPoDate">Buyer PO date</label>
                <input id="buyerPoDate" type="date" className="input" value={h.buyerPoDate} onChange={(ev) => setH({ ...h, buyerPoDate: ev.target.value })} />
                {e.buyerPoDate && <div className="error">{e.buyerPoDate}</div>}
              </div>
              <div className="field full">
                <label htmlFor="deliveryAddress">Delivery address</label>
                <textarea id="deliveryAddress" rows={2} value={h.deliveryAddress} onChange={(ev) => setH({ ...h, deliveryAddress: ev.target.value })} />
              </div>
            </>
          )}
          <div className={`field${e.terms ? " has-error" : ""}`}>
            <label htmlFor="terms">Terms</label>
            <select id="terms" value={h.terms} onChange={(ev) => setH({ ...h, terms: ev.target.value })}>
              <option value="">None</option>
              {terms.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className={`field${e.withholdingCodes || e.withholding ? " has-error" : ""}`}>
            <span className="label">Withholding</span>
            <div className="wh-computed" role="status" aria-label="Withholding from line rates">
              {computedDocRates.length === 0 ? (
                <span className="small faint">None from line rates</span>
              ) : (
                computedDocRates.map((r) => (
                  <span key={r.code} className="chip">
                    {r.label}
                    {r.atcCode && !isUnverifiedGovAtc(r.atcCode) ? ` · ${r.atcCode}` : isUnverifiedGovAtc(r.atcCode) ? ` · ${GOV_ATC_CODE_TO_CONFIRM}` : ""}
                  </span>
                ))
              )}
            </div>
            {e.withholdingCodes || e.withholding ? (
              <div className="error">{e.withholdingCodes ?? e.withholding}</div>
            ) : (
              <div className="hint">From each line&apos;s WH% · ATC (read-only). Change a line to update the total.</div>
            )}
            {/* rates kept available for label lookup; unused pick list intentionally omitted */}
            {rates.length === 0 && null}
          </div>
          <div className="field full">
            <label htmlFor="notes">Notes</label>
            <textarea id="notes" rows={2} value={h.notes} onChange={(ev) => setH({ ...h, notes: ev.target.value })} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Items</h2>
          <div className="right" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={!customer}
              onClick={() => applyCustomerDefaults(customer?.withholdingType, items, {}, { skipOverrides: true })}
            >
              {REAPPLY_WITHHOLDING_LABEL}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setItems((xs) => [...xs, blankItem(customer?.withholdingType)])}>
              Add line
            </button>
          </div>
        </div>
        {itemErrors.length > 0 && (
          <div className="alert error" role="alert">
            {itemErrors.map(([k, m]) => {
              const n = Number(k.split(".")[1]);
              return <div key={k}>{Number.isFinite(n) ? `Line ${n + 1}: ${m}` : m}</div>;
            })}
          </div>
        )}
        <div className="edit-table items-edit">
          <table className="list">
            <thead>
              <tr>
                <th>Description</th>
                <th>Kind</th>
                <th className="num">Qty</th>
                <th>Unit</th>
                {withCosts && <th>Supplier</th>}
                {withCosts && <th className="num">Supplier unit</th>}
                {withCosts && <th className="num">Supplier total</th>}
                <th className="num">HACIEN price</th>
                <th className="num">Total</th>
                {withCosts && <th className="num">Margin</th>}
                <th className="num col-wh">WH% / ATC</th>
                <th aria-label="Line actions" />
              </tr>
            </thead>
            <tbody>
              {items.map((i, idx) => {
                const a = safeLine(i);
                const pct =
                  i.withholdingRate == null || i.withholdingRate === ""
                    ? ""
                    : (Number(i.withholdingRate) * 100).toFixed(2).replace(/\.?0+$/, "");
                const showOverride =
                  i.withholdingOverride ||
                  lineDiffersFromUsual(customer?.withholdingType, i.kind, { rate: i.withholdingRate, atc: i.withholdingAtc });
                const govAtc = isUnverifiedGovAtc(i.withholdingAtc);
                return (
                  <tr key={i.key}>
                    <td>
                      <textarea aria-label={`Line ${idx + 1} description`} rows={1} value={i.description} onChange={(ev) => setItem(i.key, { description: ev.target.value })} />
                      {showOverride && <div className="small muted">{OVERRIDE_NOTE}</div>}
                    </td>
                    <td>
                      <select aria-label={`Line ${idx + 1} kind`} value={i.kind} onChange={(ev) => changeKind(i.key, ev.target.value as ItemKind)}>
                        <option value="GOODS">Goods</option>
                        <option value="SERVICES">Services</option>
                      </select>
                    </td>
                    <td className="num">
                      <input aria-label={`Line ${idx + 1} qty`} inputMode="decimal" className="w-num-s" value={i.qty} onChange={(ev) => setItem(i.key, { qty: ev.target.value })} />
                    </td>
                    <td>
                      <input aria-label={`Line ${idx + 1} unit`} className="w-unit" value={i.unit} onChange={(ev) => setItem(i.key, { unit: ev.target.value })} />
                    </td>
                    {withCosts && (
                      <td>
                        <select aria-label={`Line ${idx + 1} supplier`} value={i.supplierId ?? ""} onChange={(ev) => setItem(i.key, { supplierId: ev.target.value || null })}>
                          <option value="">—</option>
                          {suppliers!.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    )}
                    {withCosts && (
                      <td className="num">
                        <input
                          aria-label={`Line ${idx + 1} supplier unit cost`}
                          inputMode="decimal"
                          className="w-num"
                          value={i.supplierUnitCost}
                          onChange={(ev) => setItem(i.key, { supplierUnitCost: ev.target.value })}
                        />
                      </td>
                    )}
                    {withCosts && <td className="num muted">{formatPeso(a.supplierTotal)}</td>}
                    <td className="num">
                      <input aria-label={`Line ${idx + 1} HACIEN unit price`} inputMode="decimal" className="w-num" value={i.unitPrice} onChange={(ev) => setItem(i.key, { unitPrice: ev.target.value })} />
                    </td>
                    <td className="num strong">{formatPeso(a.total)}</td>
                    {withCosts && <td className={`num${toScaled(a.margin, 2) < 0n ? " neg" : ""}`}>{formatPeso(a.margin)}</td>}
                    <td className="num col-wh">
                      <input
                        aria-label={`Line ${idx + 1} withholding percent`}
                        inputMode="decimal"
                        className="w-wh"
                        value={pct}
                        placeholder="—"
                        onChange={(ev) => {
                          const raw = ev.target.value.trim();
                          if (raw === "") {
                            changeLineWithholding(i.key, { withholdingRate: null });
                            return;
                          }
                          const n = Number(raw);
                          const rate = Number.isFinite(n) ? (n / 100).toFixed(4) : "0.0000";
                          changeLineWithholding(i.key, { withholdingRate: rate });
                        }}
                      />
                      {govAtc ? (
                        <div className="small muted" title={i.withholdingAtc ?? undefined}>
                          {GOV_ATC_CODE_TO_CONFIRM}
                        </div>
                      ) : (
                        <input
                          aria-label={`Line ${idx + 1} ATC`}
                          className="w-atc"
                          value={i.withholdingAtc ?? ""}
                          placeholder="ATC"
                          onChange={(ev) => changeLineWithholding(i.key, { withholdingAtc: ev.target.value || null })}
                        />
                      )}
                    </td>
                    <td className="line-actions">
                      <button type="button" className="btn-link" aria-label={`Move line ${idx + 1} up`} disabled={idx === 0} onClick={() => move(idx, -1)}>
                        ↑
                      </button>
                      <button type="button" className="btn-link" aria-label={`Move line ${idx + 1} down`} disabled={idx === items.length - 1} onClick={() => move(idx, 1)}>
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn-link danger"
                        aria-label={`Remove line ${idx + 1}`}
                        disabled={items.length === 1}
                        onClick={() => setItems((xs) => xs.filter((x) => x.key !== i.key))}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="totals-wrap">
          <TotalsBox totals={totals} showCosts={withCosts} />
        </div>
      </div>

      <div className="form-actions">
        <button className="btn" type="submit" disabled={pending || (mode === "quote" && !h.customerId)}>
          {pending ? "Saving…" : isNew ? "Create quote" : "Save changes"}
        </button>
        <a className="btn btn-secondary" href={cancelHref}>
          Cancel
        </a>
      </div>
    </form>
  );
}
