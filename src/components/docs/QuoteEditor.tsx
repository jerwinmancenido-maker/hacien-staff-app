"use client";

// Quote-only editor (Brief 09 Phase 1). Style hooks (CSS added separately):
// quote-editor, quote-details-card, quote-meta-chip, quote-tabs, quote-tab, quote-tab-on,
// quote-trow, quote-int2, quote-tbox, quote-sticky-act, quote-fg, quote-f, quote-f-w2, quote-f-w3

import Link from "next/link";
import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { useFormAction } from "@/components/useFormAction";
import { amountInWords } from "@/lib/print/amount-in-words";
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
import { parseWithholdingPercentInput } from "@/lib/quotes/withholding-percent";
import { formatPeso } from "@/lib/format";
import type { FormState } from "@/lib/validation/forms";
import { QuoteStatusChip } from "./DocParts";
import { AddCustomerDialog } from "./AddCustomerDialog";
import type { CreatedQuoteCustomer } from "@/app/(app)/quotes/create-customer-action";
import {
  type EditorCustomer,
  type EditorInitial,
  type EditorItem,
} from "./DocumentEditor";

export type { EditorCustomer, EditorInitial, EditorItem };

type QuoteEditorInitial = EditorInitial & {
  internalNotes?: string;
  subject?: string;
  buyerPoNo?: string;
};

export type QuoteEditorProps = {
  isNew: boolean;
  quoteId: string | null;
  quoteNumber: string | null;
  revision: number;
  status: string;
  initial: QuoteEditorInitial;
  customers: EditorCustomer[];
  rates: WithholdingSnapshot[];
  suppliers: { id: string; name: string }[] | null;
  termsOptions: string[];
  defaultValidityDays: number;
  printDefaults: { quoteTerms: string; deliveryNotes: string; warrantyNotes: string };
  preparedByName: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  cancelHref: string;
  markSentAction?: (id: string) => Promise<FormState>;
};

type TabId = "items" | "terms" | "notes" | "signoff";

/** Stable across SSR/client — never use a module counter (hydration mismatch). */
function blankItem(customerType: string | null | undefined, key: string): EditorItem {
  const wh = lineWithholdingSnapshot(customerType, "GOODS");
  return {
    key,
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

/** Grow a description textarea to fit its content (no clipped 2nd line). */
function growDesc(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "0px";
  el.style.height = `${Math.max(el.scrollHeight + 2, 36)}px`;
}

function DescTextarea({
  label,
  value,
  onValue,
}: {
  label: string;
  value: string;
  onValue: (v: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    growDesc(ref.current);
  }, [value]);
  return (
    <textarea
      ref={ref}
      aria-label={label}
      className="quote-desc"
      rows={1}
      value={value}
      onChange={(ev) => {
        onValue(ev.target.value);
        growDesc(ev.target);
      }}
    />
  );
}

function customerTypeLabel(type: string): string {
  if (type === "GOVERNMENT") return "Government";
  if (type === "TOP_WITHHOLDING_AGENT") return "Top withholding agent";
  if (type === "NONE") return "Private";
  return type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function customerWithholdingHint(type: string): string {
  if (type === "GOVERNMENT" || type === "TOP_WITHHOLDING_AGENT") return "Goods 1% (WI158) · Services 2% (WI160)";
  if (type === "NONE") return "No withholding";
  return "Used on every line for this customer. You can change it per line.";
}

function createdToEditorCustomer(c: CreatedQuoteCustomer): EditorCustomer {
  return {
    id: c.id,
    name: c.name,
    address: c.address,
    defaultTerms: c.defaultTerms,
    withholdingType: c.withholdingType,
    contacts: c.contacts,
  };
}

export function QuoteEditor({
  isNew,
  quoteId,
  quoteNumber,
  revision,
  status,
  initial,
  customers: customersProp,
  rates,
  suppliers,
  termsOptions,
  defaultValidityDays,
  printDefaults,
  preparedByName,
  action,
  cancelHref,
  markSentAction,
}: QuoteEditorProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const { state, pending, onSubmit } = useFormAction(action);
  const [sentPending, startSentTransition] = useTransition();
  void rates; // API parity with DocumentEditor; line rates drive WH display.
  const withCosts = suppliers !== null;
  const [customerList, setCustomerList] = useState(customersProp);
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [tab, setTab] = useState<TabId>("items");
  // Client-only line keys for rows added after mount (initial keys are SSR-stable).
  const lineKeySeq = useRef(0);
  const allocLineKey = () => `n${++lineKeySeq.current}`;

  const [h, setH] = useState(() => ({
    ...initial,
    internalNotes: initial.internalNotes ?? "",
    subject: initial.subject ?? "",
    buyerPoNo: initial.buyerPoNo ?? "",
    withholdingCodes: initial.withholdingCodes.filter((c) => c !== WITHHOLDING_DEFAULT_CODES.GOV_VAT_5 || allowGovVatOption()),
  }));

  const [items, setItems] = useState<EditorItem[]>(() =>
    initial.items.length
      ? initial.items.map((i, idx) => ({
          ...i,
          key: i.id ?? `init-${idx}`,
          withholdingRate: i.withholdingRate,
          withholdingAtc: i.withholdingAtc ?? null,
          withholdingOverride: i.withholdingOverride ?? false,
        }))
      : [blankItem(customerList.find((c) => c.id === initial.customerId)?.withholdingType, "init-0")],
  );
  const [reapplyWithholding, setReapplyWithholding] = useState(false);
  const [whPctErrors, setWhPctErrors] = useState<Record<string, string>>({});
  const [whPctDrafts, setWhPctDrafts] = useState<Record<string, string>>({});

  const e = state.fieldErrors ?? {};
  const customer = customerList.find((c) => c.id === h.customerId);
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
  const belowCost = withCosts && items.some((i) => toScaled(safeLine(i).margin, 2) < 0n);

  const setItem = (key: string, patch: Partial<EditorItem>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const move = (idx: number, by: number) =>
    setItems((xs) => {
      const next = [...xs];
      const [it] = next.splice(idx, 1);
      next.splice(Math.max(0, Math.min(next.length, idx + by)), 0, it!);
      return next;
    });

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
    setWhPctDrafts({});
    setWhPctErrors({});
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
    const c = customerList.find((x) => x.id === id);
    applyCustomerDefaults(c?.withholdingType, items, {
      customerId: id,
      contactId: c?.contacts.find((k) => k.isMain)?.id ?? "",
      terms: c?.defaultTerms ?? h.terms,
    });
  }

  function onCustomerSelect(id: string) {
    if (id === "__add__") {
      setAddCustomerOpen(true);
      return;
    }
    pickCustomer(id);
  }

  function onCustomerCreated(c: CreatedQuoteCustomer) {
    const ec = createdToEditorCustomer(c);
    setCustomerList((xs) => (xs.some((x) => x.id === ec.id) ? xs : [...xs, ec]));
    // Apply immediately — customerList state is not updated yet for pickCustomer().
    applyCustomerDefaults(ec.withholdingType, items, {
      customerId: ec.id,
      contactId: ec.contacts.find((k) => k.isMain)?.id ?? "",
      terms: ec.defaultTerms ?? h.terms,
    });
  }

  function onWhPctChange(key: string, raw: string) {
    setWhPctDrafts((prev) => ({ ...prev, [key]: raw }));
    if (/^\d+\.$/.test(raw.trim())) {
      setWhPctErrors((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    const parsed = parseWithholdingPercentInput(raw);
    if (!parsed.ok) {
      setWhPctErrors((prev) => ({ ...prev, [key]: parsed.message }));
      return;
    }
    setWhPctErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    changeLineWithholding(key, { withholdingRate: parsed.rate });
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

  const payload = {
    customerId: h.customerId,
    contactId: h.contactId || null,
    date: h.date,
    validUntil: h.validUntil,
    terms: h.terms,
    notes: h.notes,
    internalNotes: h.internalNotes,
    subject: h.subject,
    buyerPoNo: h.buyerPoNo,
    withholdingCodes: computedDocRates.map((w) => w.code),
    reapplyWithholding: reapplyWithholding || undefined,
    items: items.map(itemPayload),
  };

  const itemErrors = Object.entries(e).filter(([k]) => k.startsWith("items"));
  const totalsSummary = `Contract price ${formatPeso(totals.contractPrice)} · Net received ${formatPeso(totals.netReceived)}`;

  const termsTabDot =
    Boolean(h.terms?.trim()) ||
    Boolean(printDefaults.quoteTerms?.trim()) ||
    Boolean(printDefaults.deliveryNotes?.trim()) ||
    Boolean(printDefaults.warrantyNotes?.trim());
  const notesCount = (h.notes?.trim() ? 1 : 0) + (h.internalNotes?.trim() ? 1 : 0);

  const canSubmitForApproval = quoteId && status === "DRAFT" && markSentAction;
  const busy = pending || sentPending;

  function submitForApproval() {
    if (canSubmitForApproval) {
      startSentTransition(async () => {
        await markSentAction!(quoteId!);
      });
      return;
    }
    formRef.current?.requestSubmit();
  }

  const statusLabel = status === "DRAFT" ? "Draft" : status;
  const metaTitle = isNew ? "New" : quoteNumber ?? "Quote";

  return (
    <>
      <form ref={formRef} className="quote-editor" onSubmit={onSubmit} noValidate>
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

        <div className="card quote-details-card">
          <div className="card-head">
            <h2>Quote details</h2>
            <div className="quote-meta-chip">
              <span className="small muted">
                {metaTitle} · Rev {revision}
              </span>
              <QuoteStatusChip status={isNew ? "DRAFT" : status} />
            </div>
          </div>
          <div className="quote-fg">
            <div className={`quote-f quote-f-w2 field${e.customerId ? " has-error" : ""}`}>
              <label htmlFor="customerId">
                Customer<span className="req"> *</span>
              </label>
              <select id="customerId" value={h.customerId} onChange={(ev) => onCustomerSelect(ev.target.value)}>
                <option value="__add__">+ Add new customer</option>
                <option value="">Pick a customer…</option>
                {customerList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {customer && (
                <div className="hint">
                  {customerTypeLabel(customer.withholdingType)} · {customerWithholdingHint(customer.withholdingType)}
                </div>
              )}
              {e.customerId && <div className="error">{e.customerId}</div>}
            </div>
            <div className={`quote-f field${e.validUntil ? " has-error" : ""}`}>
              <label htmlFor="validUntil">Valid until</label>
              <input id="validUntil" type="date" className="input" value={h.validUntil} onChange={(ev) => setH({ ...h, validUntil: ev.target.value })} />
              {e.validUntil ? <div className="error">{e.validUntil}</div> : <div className="hint">{defaultValidityDays} days, from Settings</div>}
            </div>
            <div className={`quote-f field${e.date ? " has-error" : ""}`}>
              <label htmlFor="date">
                Date<span className="req"> *</span>
              </label>
              <input id="date" type="date" className="input" value={h.date} onChange={(ev) => setH({ ...h, date: ev.target.value })} />
              {e.date && <div className="error">{e.date}</div>}
              {isNew && !e.date && <div className="hint">Number on save</div>}
            </div>
            <div className={`quote-f quote-f-w2 field${e.contactId ? " has-error" : ""}`}>
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
            <div className={`quote-f quote-f-w2 field${e.buyerPoNo ? " has-error" : ""}`}>
              <label htmlFor="buyerPoNo">Customer PO / RFQ no.</label>
              <input id="buyerPoNo" type="text" value={h.buyerPoNo} onChange={(ev) => setH({ ...h, buyerPoNo: ev.target.value })} />
              {e.buyerPoNo && <div className="error">{e.buyerPoNo}</div>}
            </div>
            <div className={`quote-f field full${e.subject ? " has-error" : ""}`}>
              <label htmlFor="subject">Subject / project</label>
              <input id="subject" type="text" value={h.subject} onChange={(ev) => setH({ ...h, subject: ev.target.value })} />
              {e.subject && <div className="error">{e.subject}</div>}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="quote-tabs-wrap">
            <div className="quote-tabs" role="tablist" aria-label="Quote sections">
              <button type="button" role="tab" aria-selected={tab === "items"} className={`quote-tab${tab === "items" ? " quote-tab-on" : ""}`} onClick={() => setTab("items")}>
                Items
                {items.length > 0 ? <span className="quote-tab-badge">{items.length}</span> : null}
              </button>
              <button type="button" role="tab" aria-selected={tab === "terms"} className={`quote-tab${tab === "terms" ? " quote-tab-on" : ""}`} onClick={() => setTab("terms")}>
                Terms &amp; conditions
                {termsTabDot ? <span className="quote-tab-dot" aria-hidden /> : null}
              </button>
              <button type="button" role="tab" aria-selected={tab === "notes"} className={`quote-tab${tab === "notes" ? " quote-tab-on" : ""}`} onClick={() => setTab("notes")}>
                Notes
                {notesCount > 0 ? <span className="quote-tab-badge">{notesCount}</span> : null}
              </button>
              <button type="button" role="tab" aria-selected={tab === "signoff"} className={`quote-tab${tab === "signoff" ? " quote-tab-on" : ""}`} onClick={() => setTab("signoff")}>
                Sign-off
                <span className="quote-tab-dot" aria-hidden />
              </button>
            </div>
          </div>

          {tab === "items" && (
            <div role="tabpanel">
              <div className="card-head">
                <span className="sr-only">Items</span>
                <div className="right" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={!customer}
                    onClick={() => applyCustomerDefaults(customer?.withholdingType, items, {}, { skipOverrides: true })}
                  >
                    {REAPPLY_WITHHOLDING_LABEL}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setItems((xs) => [...xs, blankItem(customer?.withholdingType, allocLineKey())])}
                  >
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
              <div className="quote-items-desktop">
                <div className="quote-lh" aria-hidden="true">
                  <span className="quote-lh-no">#</span>
                  <span>Item</span>
                  <span className="num">Qty</span>
                  <span>Unit</span>
                  <span className="num">Unit price</span>
                  <span className="num">Line total</span>
                  <span />
                </div>
                {items.map((i, idx) => {
                  const a = safeLine(i);
                  const pctFromRate =
                    i.withholdingRate == null || i.withholdingRate === ""
                      ? ""
                      : (Number(i.withholdingRate) * 100).toFixed(2).replace(/\.?0+$/, "");
                  const pct = Object.prototype.hasOwnProperty.call(whPctDrafts, i.key) ? whPctDrafts[i.key]! : pctFromRate;
                  const showOverride =
                    i.withholdingOverride ||
                    lineDiffersFromUsual(customer?.withholdingType, i.kind, { rate: i.withholdingRate, atc: i.withholdingAtc });
                  const govAtc = isUnverifiedGovAtc(i.withholdingAtc);
                  const supplierName = suppliers?.find((s) => s.id === i.supplierId)?.name ?? "";
                  const below = toScaled(a.margin, 2) < 0n;
                  const marginPct =
                    Number(a.total) !== 0 ? ((Number(a.margin) / Number(a.total)) * 100).toFixed(1) : "0.0";
                  const whLabel = pct ? `WHT ${pct}%` : "WHT —";
                  return (
                    <div className="quote-ln" key={i.key}>
                      <div className="quote-lr">
                        <div className="quote-ln-no">{idx + 1}</div>
                        <div className="quote-ln-dsc">
                          <DescTextarea label={`Line ${idx + 1} description`} value={i.description} onValue={(v) => setItem(i.key, { description: v })} />
                          {showOverride && <div className="small muted">{OVERRIDE_NOTE}</div>}
                          <div className="quote-ln-tags">
                            <select
                              className="quote-tg"
                              aria-label={`Line ${idx + 1} kind`}
                              value={i.kind}
                              onChange={(ev) => changeKind(i.key, ev.target.value as ItemKind)}
                            >
                              <option value="GOODS">Goods</option>
                              <option value="SERVICES">Services</option>
                            </select>
                            <span className="quote-tg quote-tg-wh" title={govAtc ? `${GOV_ATC_CODE_TO_CONFIRM}${i.withholdingAtc ? ` (${i.withholdingAtc})` : ""}` : i.withholdingAtc ?? undefined}>
                              <span className="quote-tg-wh-label">{whLabel}</span>
                              {govAtc ? (
                                <span className="quote-wh-tip" aria-label={GOV_ATC_CODE_TO_CONFIRM}>
                                  ?
                                </span>
                              ) : i.withholdingAtc ? (
                                <span className="quote-tg-atc">{i.withholdingAtc}</span>
                              ) : null}
                              <input
                                aria-label={`Line ${idx + 1} withholding percent`}
                                inputMode="decimal"
                                className="w-wh"
                                value={pct}
                                placeholder="—"
                                onChange={(ev) => onWhPctChange(i.key, ev.target.value)}
                              />
                              {!govAtc ? (
                                <input
                                  aria-label={`Line ${idx + 1} ATC`}
                                  className="w-atc"
                                  value={i.withholdingAtc ?? ""}
                                  placeholder="ATC"
                                  onChange={(ev) => changeLineWithholding(i.key, { withholdingAtc: ev.target.value || null })}
                                />
                              ) : null}
                            </span>
                            {whPctErrors[i.key] ? <span className="error small">{whPctErrors[i.key]}</span> : null}
                          </div>
                        </div>
                        <div className="quote-ln-qty">
                          <input aria-label={`Line ${idx + 1} qty`} inputMode="decimal" value={i.qty} onChange={(ev) => setItem(i.key, { qty: ev.target.value })} />
                        </div>
                        <div className="quote-ln-unit">
                          <input aria-label={`Line ${idx + 1} unit`} value={i.unit} onChange={(ev) => setItem(i.key, { unit: ev.target.value })} />
                        </div>
                        <div className="quote-ln-price">
                          <input
                            aria-label={`Line ${idx + 1} HACIEN unit price`}
                            inputMode="decimal"
                            value={i.unitPrice}
                            onChange={(ev) => setItem(i.key, { unitPrice: ev.target.value })}
                          />
                        </div>
                        <div className="quote-ln-total num strong">{formatPeso(a.total)}</div>
                        <div className="line-actions">
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
                        </div>
                      </div>
                      {withCosts ? (
                        <div className={`quote-cost${below ? " quote-cost-warn" : ""}`}>
                          <span className="quote-cost-k">Cost (internal)</span>
                          <span className="quote-cost-field">
                            Supplier{" "}
                            <select
                              aria-label={`Line ${idx + 1} supplier`}
                              title={supplierName || undefined}
                              value={i.supplierId ?? ""}
                              onChange={(ev) => setItem(i.key, { supplierId: ev.target.value || null })}
                            >
                              <option value="">—</option>
                              {suppliers!.map((s) => (
                                <option key={s.id} value={s.id} title={s.name}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          </span>
                          <span className="quote-cost-field">
                            Unit cost{" "}
                            <input
                              aria-label={`Line ${idx + 1} supplier unit cost`}
                              inputMode="decimal"
                              value={i.supplierUnitCost}
                              onChange={(ev) => setItem(i.key, { supplierUnitCost: ev.target.value })}
                            />
                          </span>
                          <span className={`quote-cost-field${below ? " neg" : ""}`}>
                            Margin{" "}
                            <b>
                              {below ? `⚠ Price is below cost · ${formatPeso(a.margin)} · ${marginPct}%` : `${formatPeso(a.margin)} · ${marginPct}%`}
                            </b>
                          </span>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="quote-items-mobile">
                {items.map((i, idx) => {
                  const a = safeLine(i);
                  const pctFromRate =
                    i.withholdingRate == null || i.withholdingRate === ""
                      ? ""
                      : (Number(i.withholdingRate) * 100).toFixed(2).replace(/\.?0+$/, "");
                  const pct = Object.prototype.hasOwnProperty.call(whPctDrafts, i.key) ? whPctDrafts[i.key]! : pctFromRate;
                  const showOverride =
                    i.withholdingOverride ||
                    lineDiffersFromUsual(customer?.withholdingType, i.kind, { rate: i.withholdingRate, atc: i.withholdingAtc });
                  const govAtc = isUnverifiedGovAtc(i.withholdingAtc);
                  const supplierName = suppliers?.find((s) => s.id === i.supplierId)?.name ?? "";
                  return (
                    <article key={`m-${i.key}`} className="quote-line-card">
                      <div className="quote-line-card-actions line-actions">
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
                      </div>
                      <div className="quote-line-card-desc">
                        <DescTextarea label={`Line ${idx + 1} description`} value={i.description} onValue={(v) => setItem(i.key, { description: v })} />
                        {showOverride && <div className="small muted">{OVERRIDE_NOTE}</div>}
                      </div>
                      <div className="quote-line-card-row3">
                        <div className="field">
                          <label className="sr-only" htmlFor={`m-kind-${i.key}`}>
                            Kind
                          </label>
                          <select id={`m-kind-${i.key}`} aria-label={`Line ${idx + 1} kind`} value={i.kind} onChange={(ev) => changeKind(i.key, ev.target.value as ItemKind)}>
                            <option value="GOODS">Goods</option>
                            <option value="SERVICES">Services</option>
                          </select>
                        </div>
                        <div className="field">
                          <label className="sr-only" htmlFor={`m-qty-${i.key}`}>
                            Qty
                          </label>
                          <input
                            id={`m-qty-${i.key}`}
                            aria-label={`Line ${idx + 1} qty`}
                            inputMode="decimal"
                            value={i.qty}
                            onChange={(ev) => setItem(i.key, { qty: ev.target.value })}
                          />
                        </div>
                        <div className="field">
                          <label className="sr-only" htmlFor={`m-unit-${i.key}`}>
                            Unit
                          </label>
                          <input
                            id={`m-unit-${i.key}`}
                            aria-label={`Line ${idx + 1} unit`}
                            value={i.unit}
                            onChange={(ev) => setItem(i.key, { unit: ev.target.value })}
                          />
                        </div>
                      </div>
                      {withCosts && (
                        <div className="quote-line-card-row2">
                          <div className="field">
                            <label className="sr-only" htmlFor={`m-sup-${i.key}`}>
                              Supplier
                            </label>
                            <select
                              id={`m-sup-${i.key}`}
                              aria-label={`Line ${idx + 1} supplier`}
                              title={supplierName || undefined}
                              value={i.supplierId ?? ""}
                              onChange={(ev) => setItem(i.key, { supplierId: ev.target.value || null })}
                            >
                              <option value="">Supplier —</option>
                              {suppliers!.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="field">
                            <label className="sr-only" htmlFor={`m-cost-${i.key}`}>
                              Unit cost
                            </label>
                            <input
                              id={`m-cost-${i.key}`}
                              aria-label={`Line ${idx + 1} supplier unit cost`}
                              inputMode="decimal"
                              value={i.supplierUnitCost}
                              placeholder="Unit cost"
                              onChange={(ev) => setItem(i.key, { supplierUnitCost: ev.target.value })}
                            />
                          </div>
                        </div>
                      )}
                      <div className="quote-line-card-price">
                        <div className="field">
                          <label className="sr-only" htmlFor={`m-price-${i.key}`}>
                            Price
                          </label>
                          <input
                            id={`m-price-${i.key}`}
                            aria-label={`Line ${idx + 1} HACIEN unit price`}
                            inputMode="decimal"
                            value={i.unitPrice}
                            placeholder="Price"
                            onChange={(ev) => setItem(i.key, { unitPrice: ev.target.value })}
                          />
                        </div>
                        <div className="quote-line-card-total num strong">{formatPeso(a.total)}</div>
                      </div>
                      <div className="quote-line-card-meta">
                        {withCosts ? <span>Margin {formatPeso(a.margin)}</span> : null}
                        <span className="quote-line-card-wh">
                          WH%{" "}
                          <input
                            aria-label={`Line ${idx + 1} withholding percent`}
                            inputMode="decimal"
                            className="w-wh"
                            value={pct}
                            placeholder="—"
                            onChange={(ev) => onWhPctChange(i.key, ev.target.value)}
                          />
                          {govAtc ? (
                            <span
                              className="quote-wh-tip"
                              title={`${GOV_ATC_CODE_TO_CONFIRM}${i.withholdingAtc ? ` (${i.withholdingAtc})` : ""}`}
                              aria-label={GOV_ATC_CODE_TO_CONFIRM}
                            >
                              ?
                            </span>
                          ) : (
                            <input
                              aria-label={`Line ${idx + 1} ATC`}
                              className="w-atc"
                              value={i.withholdingAtc ?? ""}
                              placeholder="ATC"
                              onChange={(ev) => changeLineWithholding(i.key, { withholdingAtc: ev.target.value || null })}
                            />
                          )}
                        </span>
                        {whPctErrors[i.key] ? <span className="error small">{whPctErrors[i.key]}</span> : null}
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="quote-trow">
                {withCosts && (
                  <div className="quote-int2">
                    <div className="small strong">INTERNAL ONLY · NEVER PRINTS</div>
                    {belowCost && (
                      <div className="alert warn" role="alert">
                        One or more lines have negative margin (below cost).
                      </div>
                    )}
                    <div className="totals-row">
                      <span>Supplier cost</span>
                      <span className="num">{formatPeso(totals.supplierCost)}</span>
                    </div>
                    <div className={`totals-row strong${Number(totals.netMargin) < 0 ? " neg" : ""}`}>
                      <span>Net margin after withholding</span>
                      <span className="num">
                        {formatPeso(totals.netMargin)} <span className="muted">({totals.netMarginPct}%)</span>
                      </span>
                    </div>
                  </div>
                )}
                <div className="quote-tbox totals-box" aria-label="Customer totals">
                  <div className="totals-row">
                    <span>Subtotal</span>
                    <span className="num">{formatPeso(totals.contractPrice)}</span>
                  </div>
                  <div className="totals-row strong">
                    <span>Contract price</span>
                    <span className="num">{formatPeso(totals.contractPrice)}</span>
                  </div>
                  <div className="totals-row">
                    <span>Less withholding (est.)</span>
                    <span className="num">{Number(totals.withholdingTotal) ? `−${formatPeso(totals.withholdingTotal)}` : formatPeso(0)}</span>
                  </div>
                  <div className="totals-row strong">
                    <span>Net received</span>
                    <span className="num">{formatPeso(totals.netReceived)}</span>
                  </div>
                  <div className="small faint" style={{ marginTop: 8 }}>
                    {amountInWords(totals.contractPrice)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === "terms" && (
            <div role="tabpanel" className="quote-fg">
              <div className={`quote-f quote-f-w2 field${e.terms ? " has-error" : ""}`}>
                <label htmlFor="terms">Payment terms</label>
                <select id="terms" value={h.terms} onChange={(ev) => setH({ ...h, terms: ev.target.value })}>
                  <option value="">None</option>
                  {terms.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <div className="hint">Prints on the quote · From Settings, edit for this quote</div>
                {e.terms && <div className="error">{e.terms}</div>}
              </div>
              <div className="quote-f quote-f-w2 field">
                <span className="label">Delivery</span>
                <div className="quote-readonly-block">{printDefaults.deliveryNotes?.trim() ? printDefaults.deliveryNotes : "—"}</div>
              </div>
              <div className="quote-f quote-f-w2 field">
                <span className="label">Warranty</span>
                <div className="quote-readonly-block">{printDefaults.warrantyNotes?.trim() ? printDefaults.warrantyNotes : "—"}</div>
              </div>
              <div className="quote-f field">
                <span className="label">Validity</span>
                <div>{defaultValidityDays} days</div>
              </div>
              <div className="quote-f field full">
                <span className="label">Terms &amp; conditions</span>
                <textarea readOnly rows={4} value={printDefaults.quoteTerms ?? ""} aria-readonly />
                <div className="hint">From Settings · Read-only in Phase 1</div>
              </div>

              <div className={`field full${e.withholdingCodes || e.withholding ? " has-error" : ""}`}>
                <span className="label">Withholding (from lines)</span>
                <div className="wh-computed" role="status">
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
                {e.withholdingCodes || e.withholding ? <div className="error">{e.withholdingCodes ?? e.withholding}</div> : null}
              </div>
              <p className="right small muted">{totalsSummary}</p>
            </div>
          )}

          {tab === "notes" && (
            <div role="tabpanel" className="quote-fg">
              <div className={`quote-f field full${e.notes ? " has-error" : ""}`}>
                <label htmlFor="notes">Notes on quote (customer sees)</label>
                <textarea id="notes" rows={4} value={h.notes} onChange={(ev) => setH({ ...h, notes: ev.target.value })} />
                <div className="hint">Prints on the quote</div>
                {e.notes && <div className="error">{e.notes}</div>}
              </div>
              <div className={`quote-f field full${e.internalNotes ? " has-error" : ""}`}>
                <label htmlFor="internalNotes">Internal notes</label>
                <textarea id="internalNotes" rows={4} value={h.internalNotes} onChange={(ev) => setH({ ...h, internalNotes: ev.target.value })} />
                <div className="hint">Internal only, never prints</div>
                {e.internalNotes && <div className="error">{e.internalNotes}</div>}
              </div>
              <p className="right small muted">{totalsSummary}</p>
            </div>
          )}

          {tab === "signoff" && (
            <div role="tabpanel" className="quote-fg">
              <div className="quote-f field">
                <span className="label">Prepared by</span>
                <div className="strong">{preparedByName}</div>
              </div>
              <div className="quote-f field">
                <span className="label">Conforme (customer)</span>
                <div className="quote-signoff-lines">
                  <div className="quote-signoff-line" />
                  <div className="small faint">Name and signature</div>
                </div>
              </div>
              <div className="hint">These print as signature lines on the quote. Editing names is Phase 2.</div>
              <p className="right small muted">{totalsSummary}</p>
            </div>
          )}
        </div>

        <div className="quote-sticky-act">
          <div className="quote-sticky-status">
            {statusLabel}
            {customer ? ` · ${customer.name}` : isNew ? " · Pick a customer" : ""}
          </div>
          <div className="quote-sticky-buttons">
            <Link className="btn btn-secondary" href={cancelHref}>
              Cancel
            </Link>
            {quoteId ? (
              <Link className="btn btn-secondary" href={`/print/quotes/${quoteId}`} target="_blank" rel="noopener noreferrer">
                Preview print
              </Link>
            ) : (
              <button type="button" className="btn btn-secondary" disabled>
                Preview print
              </button>
            )}
            <button className="btn btn-secondary" type="submit" disabled={busy || !h.customerId || Object.keys(whPctErrors).length > 0}>
              {pending ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || !h.customerId || Object.keys(whPctErrors).length > 0}
              onClick={submitForApproval}
            >
              {sentPending ? "Submitting…" : "Submit for approval"}
            </button>
          </div>
        </div>
      </form>

      <AddCustomerDialog open={addCustomerOpen} onClose={() => setAddCustomerOpen(false)} onSaved={onCustomerCreated} />
    </>
  );
}
