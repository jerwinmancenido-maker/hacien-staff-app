"use client";

// Quote-only editor (Brief 09 Phase 1 + Brief 10 manual withholding picks).
// Style hooks (CSS added separately):
// quote-editor, quote-details-card, quote-meta-chip, quote-tabs, quote-tab, quote-tab-on,
// quote-trow, quote-int2, quote-tbox, quote-sticky-act, quote-fg, quote-f, quote-f-w2, quote-f-w3

import Link from "next/link";
import { useLayoutEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useFormAction } from "@/components/useFormAction";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { WithholdingPickField } from "@/components/WithholdingPickField";
import { amountInWords } from "@/lib/print/amount-in-words";
import {
  COST_NOT_SET_LABEL,
  docTotals,
  lineAmounts,
  linesMissingSupplierCost,
  ratePctLabel,
  supplierCostMissing,
  toScaled,
  type ItemKind,
  type WithholdingSnapshot,
} from "@/lib/quotes/calc";
import { quoteMarkSentGate, quoteSaveGate } from "@/lib/quotes/approval";
import {
  lineDiffersFromUsualPicks,
  lineWithholdingChipsFromPicks,
  lineWithholdingFromPicks,
  lineWithholdingSnapshotFromPicks,
  WITHHOLDING_NOT_SET_NOTICE,
  WITHHOLDING_NONE_CONFIRM_TITLE,
  WITHHOLDING_NONE_CONFIRM_YES,
  WITHHOLDING_NONE_CONFIRM_PICK,
  WITHHOLDING_INTERNAL_PANEL_LABEL,
  INTERNAL_MARGIN_LABEL,
  INTERNAL_CASH_AFTER_WH_LABEL,
  OVERRIDE_NOTE,
  REAPPLY_WITHHOLDING_LABEL,
  WITHHOLDING_PICK_CHANGE_LABEL,
  allowGovVatOption,
  WITHHOLDING_DEFAULT_CODES,
} from "@/lib/quotes/withholding-defaults";
import { customerWithholdingHint } from "@/lib/quotes/customer-withholding-hint";
import { parseWithholdingPercentInput } from "@/lib/quotes/withholding-percent";
import { formatMoneyInput, formatPeso } from "@/lib/format";
import type { FormState } from "@/lib/validation/forms";
import { QuoteStatusChip } from "./DocParts";
import { AddCustomerDialog } from "./AddCustomerDialog";
import {
  type EditorCustomer,
  type EditorInitial,
  type EditorItem,
} from "./DocumentEditor";
import { parseTypedValidityDays, validUntilFromDays, validityDaysFromDates } from "@/lib/quotes/validity";

export type { EditorCustomer, EditorInitial, EditorItem };

type QuoteEditorInitial = EditorInitial & {
  internalNotes?: string;
  /** S-69: per-quote delivery/warranty notes; undefined = Settings default. */
  deliveryNotes?: string | null;
  warrantyNotes?: string | null;
  subject?: string;
  buyerPoNo?: string;
  validForDays?: number | string | null;
  /** Quote-level pick: null = not set, [] = none, [codes] = picks. */
  withholdingPick?: string[] | null;
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
  /** Sets pick to [] then marks sent. Used when staff confirms "Yes, none". */
  confirmNoneAndMarkSentAction?: (id: string) => Promise<FormState>;
  /** S-18: only APPROVED quotes may mark as sent from the editor. */
  approvalStatus?: "PENDING" | "APPROVED" | "REJECTED";
};

type TabId = "items" | "terms" | "notes" | "signoff";

function filterGovVatCodes(codes: string[] | null): string[] | null {
  if (codes == null) return null;
  return codes.filter((c) => c !== WITHHOLDING_DEFAULT_CODES.GOV_VAT_5 || allowGovVatOption());
}

/** Prefer withholdingPick, else withholdingCodes, else null. */
function resolveInitialPick(initial: QuoteEditorInitial): string[] | null {
  if (initial.withholdingPick !== undefined) return filterGovVatCodes(initial.withholdingPick);
  if (initial.withholdingCodes !== undefined) return filterGovVatCodes(initial.withholdingCodes);
  return null;
}

function pickSnapshotsFromCodes(
  pick: string[] | null,
  rates: WithholdingSnapshot[],
): WithholdingSnapshot[] | null {
  if (pick == null) return null;
  if (pick.length === 0) return [];
  const byCode = new Map(rates.map((r) => [r.code, r]));
  const out: WithholdingSnapshot[] = [];
  for (const code of pick) {
    const snap = byCode.get(code);
    if (snap) out.push(snap);
  }
  return out;
}

function visibleRates(rates: WithholdingSnapshot[]): WithholdingSnapshot[] {
  if (allowGovVatOption()) return rates;
  return rates.filter((r) => r.code !== WITHHOLDING_DEFAULT_CODES.GOV_VAT_5);
}

/** Stable across SSR/client — never use a module counter (hydration mismatch). */
function blankItem(picks: readonly WithholdingSnapshot[], key: string): EditorItem {
  const wh = lineWithholdingSnapshotFromPicks(picks, "GOODS");
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

function toEditorCustomer(c: EditorCustomer | (Omit<EditorCustomer, "defaultWithholding"> & { defaultWithholding?: string[] | null })): EditorCustomer {
  return {
    id: c.id,
    name: c.name,
    address: c.address,
    defaultTerms: c.defaultTerms,
    withholdingType: c.withholdingType,
    defaultWithholding: c.defaultWithholding ?? null,
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
  rates: allRates,
  suppliers,
  termsOptions,
  defaultValidityDays,
  printDefaults,
  preparedByName,
  action,
  cancelHref,
  markSentAction,
  confirmNoneAndMarkSentAction,
  approvalStatus = "PENDING",
}: QuoteEditorProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const { state, pending, onSubmit } = useFormAction(action);
  const skipCostWarn = useRef(false);
  /** Set when "Yes, none" is confirmed on a draft save, so the re-submit saves. */
  const skipWhNoneWarn = useRef(false);
  const alsoMarkSentRef = useRef<HTMLInputElement>(null);
  /** Cost warning already shown; Yes, none must save the cleared cost in the same request. */
  const sendAfterCostWarn = useRef(false);
  const [costConfirmOpen, setCostConfirmOpen] = useState(false);
  const [costConfirmNext, setCostConfirmNext] = useState<"save" | "sent">("save");
  const [sentPending, startSentTransition] = useTransition();
  const rates = visibleRates(allRates);
  const withCosts = suppliers !== null;
  const [customerList, setCustomerList] = useState(customersProp);
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [noneConfirmOpen, setNoneConfirmOpen] = useState(false);
  /** S-79: same "No withholding on this quote?" confirm, for a draft save. */
  const [saveNoneConfirmOpen, setSaveNoneConfirmOpen] = useState(false);
  const [tab, setTab] = useState<TabId>("items");
  // Client-only line keys for rows added after mount (initial keys are SSR-stable).
  const lineKeySeq = useRef(0);
  const allocLineKey = () => `n${++lineKeySeq.current}`;

  const [h, setH] = useState(() => {
    const pick = resolveInitialPick(initial);
    return {
      ...initial,
      internalNotes: initial.internalNotes ?? "",
      deliveryNotes: initial.deliveryNotes ?? "",
      warrantyNotes: initial.warrantyNotes ?? "",
      subject: initial.subject ?? "",
      buyerPoNo: initial.buyerPoNo ?? "",
      withholdingPick: pick,
      withholdingCodes: pick,
    };
  });

  const initialPickSnaps = pickSnapshotsFromCodes(resolveInitialPick(initial), rates) ?? [];
  const [items, setItems] = useState<EditorItem[]>(() =>
    initial.items.length
      ? initial.items.map((i, idx) => ({
          ...i,
          key: i.id ?? `init-${idx}`,
          withholdingRate: i.withholdingRate,
          withholdingAtc: i.withholdingAtc ?? null,
          withholdingOverride: i.withholdingOverride ?? false,
        }))
      : [blankItem(initialPickSnaps, "init-0")],
  );
  const [reapplyWithholding, setReapplyWithholding] = useState(false);
  const [whPctErrors, setWhPctErrors] = useState<Record<string, string>>({});
  const [whPctDrafts, setWhPctDrafts] = useState<Record<string, string>>({});
  /** Expanded withholding checkboxes under Quote details (collapsed by default). */
  const [whPickOpen, setWhPickOpen] = useState(() => resolveInitialPick(initial) == null);

  const initialDays =
    initial.validForDays != null
      ? String(initial.validForDays)
      : initial.validUntil && initial.date
        ? String(validityDaysFromDates(initial.date, initial.validUntil) ?? defaultValidityDays)
        : String(defaultValidityDays);
  const [validForDays, setValidForDays] = useState<string>(initialDays);

  function onValidForDaysChange(val: string) {
    setValidForDays(val);
    const n = parseTypedValidityDays(val);
    if (n !== null && h.date) {
      const nextDate = validUntilFromDays(h.date, n);
      if (nextDate) {
        setH((prev) => ({ ...prev, validUntil: nextDate }));
      }
    }
  }

  function onValidUntilChange(val: string) {
    setH((prev) => ({ ...prev, validUntil: val }));
    if (val && h.date) {
      const days = validityDaysFromDates(h.date, val);
      if (days !== null) {
        setValidForDays(String(days));
      }
    }
  }

  function onDateChange(newDate: string) {
    setH((prev) => {
      const n = parseTypedValidityDays(validForDays);
      if (n !== null && newDate) {
        const nextUntil = validUntilFromDays(newDate, n);
        return { ...prev, date: newDate, validUntil: nextUntil ?? prev.validUntil };
      }
      return { ...prev, date: newDate };
    });
  }

  const nDays = parseTypedValidityDays(validForDays);
  // Quotes saved before the 1-day rule can still be edited when that same-day
  // pair is left alone. Changing either date applies the minimum.
  const legacySameDayUnchanged =
    !isNew &&
    validityDaysFromDates(initial.date, initial.validUntil) === 0 &&
    h.date === initial.date &&
    h.validUntil === initial.validUntil;
  const validityDaysError = legacySameDayUnchanged
    ? null
    : nDays === null
      ? validForDays.trim()
        ? "Must be a whole number of days."
        : "At least 1 day."
      : nDays < 1
        ? "At least 1 day."
        : null;
  const validUntilError =
    h.validUntil && h.date && h.validUntil < h.date
      ? "Valid until can't be before the quote date."
      : null;
  const hasValidityError = Boolean(validityDaysError || validUntilError);

  const derivedDays =
    nDays != null && nDays >= 1
      ? nDays
      : h.date && h.validUntil
        ? validityDaysFromDates(h.date, h.validUntil)
        : null;

  const e = state.fieldErrors ?? {};
  const customer = customerList.find((c) => c.id === h.customerId);
  const contacts = customer?.contacts ?? [];
  const terms = h.terms && !termsOptions.includes(h.terms) ? [...termsOptions, h.terms] : termsOptions;

  const pick = h.withholdingPick;
  const pickSnapshots = pickSnapshotsFromCodes(pick, rates);
  const linePicks = pickSnapshots ?? [];
  // Hint under Customer always mirrors this quote's current pick (live as boxes change).
  const quotePickHint = customerWithholdingHint(pickSnapshots);

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
  // Non-empty pick → whole-total rates appear as own lines and sum == total.
  const t = docTotals(lineInputs, hasNonEmptyPicks(pickSnapshots) ? pickSnapshots! : undefined);
  const totals = { ...t, withholding: t.withholding.map((w) => ({ ...w, pctLabel: ratePctLabel(w.rate) })) };
  const belowCost = withCosts && items.some((i) => toScaled(safeLine(i).margin, 2) < 0n);
  const notSet = pick == null;

  const setItem = (key: string, patch: Partial<EditorItem>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const move = (idx: number, by: number) =>
    setItems((xs) => {
      const next = [...xs];
      const [it] = next.splice(idx, 1);
      next.splice(Math.max(0, Math.min(next.length, idx + by)), 0, it!);
      return next;
    });

  function applyPickDefaults(
    nextPick: string[] | null,
    nextItems: EditorItem[],
    headerPatch: Partial<typeof h> = {},
    opts: { skipOverrides?: boolean } = {},
  ) {
    const snaps = pickSnapshotsFromCodes(nextPick, rates) ?? [];
    const refreshed = nextItems.map((i) => {
      if (opts.skipOverrides && i.withholdingOverride) return i;
      const wh = lineWithholdingSnapshotFromPicks(snaps, i.kind);
      return { ...i, withholdingRate: wh.withholdingRate, withholdingAtc: wh.withholdingAtc, withholdingOverride: false };
    });
    setItems(refreshed);
    setWhPctDrafts({});
    setWhPctErrors({});
    setH((v) => ({
      ...v,
      ...headerPatch,
      withholdingPick: nextPick,
      withholdingCodes: nextPick,
    }));
    setReapplyWithholding(true);
  }

  function pickCustomer(id: string) {
    const c = customerList.find((x) => x.id === id);
    applyPickDefaults(c?.defaultWithholding ?? null, items, {
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

  function onCustomerCreated(c: EditorCustomer | (Omit<EditorCustomer, "defaultWithholding"> & { defaultWithholding?: string[] | null })) {
    const ec = toEditorCustomer(c);
    setCustomerList((xs) => (xs.some((x) => x.id === ec.id) ? xs : [...xs, ec]));
    applyPickDefaults(ec.defaultWithholding ?? null, items, {
      customerId: ec.id,
      contactId: ec.contacts.find((k) => k.isMain)?.id ?? "",
      terms: ec.defaultTerms ?? h.terms,
    });
  }

  function changeQuotePick(next: string[] | null) {
    applyPickDefaults(filterGovVatCodes(next), items, {}, { skipOverrides: true });
  }

  function reapplyFromCustomer() {
    applyPickDefaults(customer?.defaultWithholding ?? null, items, {}, { skipOverrides: true });
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
        const wh = lineWithholdingSnapshotFromPicks(linePicks, kind);
        return { ...x, kind, withholdingRate: wh.withholdingRate, withholdingAtc: wh.withholdingAtc, withholdingOverride: false };
      }),
    );
  }

  function changeLineWithholding(key: string, patch: { withholdingRate?: string | null; withholdingAtc?: string | null }) {
    setItems((xs) =>
      xs.map((x) => {
        if (x.key !== key) return x;
        const next = { ...x, ...patch };
        const differs = lineDiffersFromUsualPicks(linePicks, next.kind, { rate: next.withholdingRate, atc: next.withholdingAtc });
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
    validForDays: nDays != null && nDays >= 1 ? nDays : undefined,
    terms: h.terms,
    notes: h.notes,
    deliveryNotes: h.deliveryNotes,
    warrantyNotes: h.warrantyNotes,
    internalNotes: h.internalNotes,
    subject: h.subject,
    buyerPoNo: h.buyerPoNo,
    // null = not set; [] = explicit none.
    withholdingCodes: pick,
    withholdingExplicitNone: pick != null && pick.length === 0 ? true : undefined,
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

  const canMarkSent = quoteId && status === "DRAFT" && approvalStatus === "APPROVED" && markSentAction;
  const busy = pending || sentPending;

  function markSentNow() {
    if (!canMarkSent || !quoteId || !markSentAction) return;
    startSentTransition(async () => {
      await markSentAction(quoteId);
    });
  }

  function confirmNoneAndMarkSent() {
    if (!quoteId) return;
    setNoneConfirmOpen(false);
    // Cleared costs have to be saved with the send. The side action would mark
    // the already-approved quote sent and drop the clear.
    if (sendAfterCostWarn.current && formRef.current) {
      sendAfterCostWarn.current = false;
      const payloadInput = formRef.current.querySelector<HTMLInputElement>('input[name="payload"]');
      if (payloadInput) {
        const data = JSON.parse(payloadInput.value) as { withholdingCodes?: unknown; withholdingExplicitNone?: boolean };
        data.withholdingCodes = [];
        data.withholdingExplicitNone = true;
        payloadInput.value = JSON.stringify(data);
      }
      skipCostWarn.current = true;
      if (alsoMarkSentRef.current) alsoMarkSentRef.current.value = "1";
      formRef.current.requestSubmit();
      return;
    }
    startSentTransition(async () => {
      // Persist explicit none locally so a concurrent draft save matches.
      applyPickDefaults([], items);
      const fn = confirmNoneAndMarkSentAction ?? markSentAction;
      if (fn) await fn(quoteId);
    });
  }

  function onSubmitMaybeWarn(e: FormEvent<HTMLFormElement>) {
    if (hasValidityError) {
      e.preventDefault();
      return;
    }
    // S-79: same order as Mark as sent — cost warning first, then the
    // no-withholding question. A cost "Save anyway" re-submits with
    // skipCostWarn set, so the withholding question still follows it.
    const gate = quoteSaveGate({
      withholdingUnset: pick == null,
      supplierCostMissing: !skipCostWarn.current && withCosts && linesMissingSupplierCost(items),
    });
    if (gate === "cost-warning") {
      e.preventDefault();
      if (alsoMarkSentRef.current) alsoMarkSentRef.current.value = "";
      setCostConfirmNext("save");
      setCostConfirmOpen(true);
      return;
    }
    if (gate === "withholding-unset" && !skipWhNoneWarn.current) {
      e.preventDefault();
      setSaveNoneConfirmOpen(true);
      return;
    }
    if (!skipCostWarn.current && alsoMarkSentRef.current) alsoMarkSentRef.current.value = "";
    skipCostWarn.current = false;
    skipWhNoneWarn.current = false;
    onSubmit(e);
  }

  /**
   * S-79, "Yes, none" on a draft save: save explicit none ([]) in this same
   * request, exactly like the Mark-as-sent confirm does for its request.
   * "Pick rates" only closes the dialog — nothing is saved or submitted.
   * This is also the Submit-for-approval path: the save itself puts a new
   * quote at PENDING (or resets an edited quote to PENDING).
   */
  function confirmSaveNone() {
    if (!formRef.current) return;
    setSaveNoneConfirmOpen(false);
    // Keep local state consistent, and rewrite the payload the form is about
    // to submit (state has not re-rendered yet when requestSubmit fires).
    applyPickDefaults([], items);
    const payloadInput = formRef.current.querySelector<HTMLInputElement>('input[name="payload"]');
    if (payloadInput) {
      const data = JSON.parse(payloadInput.value) as { withholdingCodes?: unknown; withholdingExplicitNone?: boolean };
      data.withholdingCodes = [];
      data.withholdingExplicitNone = true;
      payloadInput.value = JSON.stringify(data);
    }
    // A draft save never marks sent, even if a cost "sent" path set the flag.
    if (alsoMarkSentRef.current) alsoMarkSentRef.current.value = "";
    skipCostWarn.current = true;
    skipWhNoneWarn.current = true;
    formRef.current.requestSubmit();
  }

  function confirmCostAnyway() {
    const next = costConfirmNext;
    setCostConfirmOpen(false);
    if (next === "sent" && pick == null) {
      sendAfterCostWarn.current = true;
      setNoneConfirmOpen(true);
      return;
    }
    sendAfterCostWarn.current = false;
    skipCostWarn.current = true;
    if (alsoMarkSentRef.current) alsoMarkSentRef.current.value = next === "sent" ? "1" : "";
    formRef.current?.requestSubmit();
  }

  function submitMarkSent() {
    if (canMarkSent) {
      const gate = quoteMarkSentGate({
        approved: true,
        withholdingUnset: pick == null,
        supplierCostMissing: withCosts && linesMissingSupplierCost(items),
      });
      if (gate === "cost-warning") {
        setCostConfirmNext("sent");
        setCostConfirmOpen(true);
        return;
      }
      if (gate === "withholding-unset") {
        setNoneConfirmOpen(true);
        return;
      }
      markSentNow();
      return;
    }
    formRef.current?.requestSubmit();
  }

  const statusLabel = status === "DRAFT" ? "Draft" : status;
  const metaTitle = isNew ? "New" : quoteNumber ?? "Quote";

  return (
    <>
      <form ref={formRef} className="quote-editor" onSubmit={onSubmitMaybeWarn} noValidate>
        <input type="hidden" name="payload" value={JSON.stringify(payload)} />
        <input ref={alsoMarkSentRef} type="hidden" name="alsoMarkSent" value="" />
        {state.message && (
          <div className={`alert ${state.ok ? "ok" : "error"}`} role="status">
            {state.message}
          </div>
        )}

        {notSet && (
          <div className="alert wh-not-set" role="alert">
            {WITHHOLDING_NOT_SET_NOTICE}
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
                  {[customerTypeLabel(customer.withholdingType), quotePickHint].filter(Boolean).join(" · ")}
                </div>
              )}
              {e.customerId && <div className="error">{e.customerId}</div>}
            </div>
            <div className={`quote-f field${e.contactId ? " has-error" : ""}`}>
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
            <div className={`quote-f field${e.date ? " has-error" : ""}`}>
              <label htmlFor="date">
                Date<span className="req"> *</span>
              </label>
              <input id="date" type="date" className="input" value={h.date} onChange={(ev) => onDateChange(ev.target.value)} />
              {e.date && <div className="error">{e.date}</div>}
              {isNew && !e.date && <div className="hint">Number on save</div>}
            </div>
            <div className={`quote-f field${e.validForDays || validityDaysError ? " has-error" : ""}`}>
              <label htmlFor="validForDays">Valid for (days)</label>
              <input
                id="validForDays"
                type="number"
                min={legacySameDayUnchanged ? 0 : 1}
                className="input"
                value={validForDays}
                onChange={(ev) => onValidForDaysChange(ev.target.value)}
              />
              {e.validForDays || validityDaysError ? (
                <div className="error">{e.validForDays ?? validityDaysError}</div>
              ) : (
                <div className="hint">{defaultValidityDays} days default</div>
              )}
            </div>
            <div className={`quote-f field${e.validUntil || validUntilError ? " has-error" : ""}`}>
              <label htmlFor="validUntil">Valid until</label>
              <input
                id="validUntil"
                type="date"
                min={h.date}
                className="input"
                value={h.validUntil}
                onChange={(ev) => onValidUntilChange(ev.target.value)}
              />
              {e.validUntil || validUntilError ? (
                <div className="error">{e.validUntil ?? validUntilError}</div>
              ) : null}
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
            <div className={`quote-f field full${e.withholdingCodes || e.withholding ? " has-error" : ""}`}>
              <div className="wh-collapsed-row">
                <span className="label">Withholding</span>
                <div className="wh-collapsed-line">
                  <span>{quotePickHint}</span>
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => setWhPickOpen((o) => !o)}
                    aria-expanded={whPickOpen}
                  >
                    {WITHHOLDING_PICK_CHANGE_LABEL}
                  </button>
                </div>
              </div>
              {whPickOpen ? (
                <WithholdingPickField
                  rates={visibleRates(rates)}
                  value={pick}
                  onChange={changeQuotePick}
                  error={e.withholdingCodes ?? e.withholding}
                  clearToNotSet
                  showLabel={false}
                />
              ) : (
                <input type="hidden" name="defaultWithholdingJson" value={pick == null ? "" : JSON.stringify(pick)} />
              )}
              {(e.withholdingCodes || e.withholding) && !whPickOpen ? (
                <div className="error">{e.withholdingCodes ?? e.withholding}</div>
              ) : null}
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
                  <button type="button" className="btn btn-secondary btn-sm" disabled={!customer} onClick={reapplyFromCustomer}>
                    {REAPPLY_WITHHOLDING_LABEL}
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setItems((xs) => [...xs, blankItem(linePicks, allocLineKey())])}>
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
                    i.withholdingOverride || lineDiffersFromUsualPicks(linePicks, i.kind, { rate: i.withholdingRate, atc: i.withholdingAtc });
                  const pickUsual = lineWithholdingFromPicks(linePicks, i.kind);
                  const pickChips = lineWithholdingChipsFromPicks(linePicks, i.kind);
                  // Stacked picks → one chip per code (never combined % beside one ATC).
                  const usePickChips = !showOverride && pickChips.length > 0;
                  const displayAtc = showOverride
                    ? i.withholdingAtc
                    : pickUsual.atc;
                  const supplierName = suppliers?.find((s) => s.id === i.supplierId)?.name ?? "";
                  const costMissing = supplierCostMissing(i.supplierUnitCost);
                  const below = !costMissing && toScaled(a.margin, 2) < 0n;
                  const marginPct = Number(a.total) !== 0 ? ((Number(a.margin) / Number(a.total)) * 100).toFixed(1) : "0.0";
                  const marginText = costMissing
                    ? COST_NOT_SET_LABEL
                    : below
                      ? `⚠ Price is below cost · ${formatPeso(a.margin)} · ${marginPct}%`
                      : `${formatPeso(a.margin)} · ${marginPct}%`;
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
                            {usePickChips ? (
                              pickChips.map((chip) => (
                                <span
                                  key={`${i.key}-${chip.code}`}
                                  className="quote-tg quote-tg-wh is-chip"
                                  title={chip.atc ?? undefined}
                                  aria-label={`Line ${idx + 1} ${chip.chipLabel}`}
                                >
                                  {chip.chipLabel}
                                </span>
                              ))
                            ) : (
                              <span className="quote-tg quote-tg-wh" title={displayAtc ?? undefined}>
                                <span className="quote-tg-wh-label">{whLabel}</span>
                                <input
                                  aria-label={`Line ${idx + 1} withholding percent`}
                                  inputMode="decimal"
                                  className="w-wh"
                                  value={pct}
                                  placeholder="—"
                                  onChange={(ev) => onWhPctChange(i.key, ev.target.value)}
                                />
                                <span className="quote-wh-pct-suffix" aria-hidden>
                                  %
                                </span>
                                {/* ATC only when not a stacked combined rate. */}
                                <input
                                  aria-label={`Line ${idx + 1} ATC`}
                                  className="w-atc"
                                  value={displayAtc ?? ""}
                                  placeholder="ATC"
                                  title={displayAtc ?? undefined}
                                  onChange={(ev) => changeLineWithholding(i.key, { withholdingAtc: ev.target.value || null })}
                                />
                              </span>
                            )}
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
                            onChange={(ev) => setItem(i.key, { unitPrice: formatMoneyInput(ev.target.value) })}
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
                              onChange={(ev) => setItem(i.key, { supplierUnitCost: formatMoneyInput(ev.target.value) })}
                            />
                          </span>
                          <span className={`quote-cost-field${below ? " neg" : ""}`}>
                            Margin{" "}
                            <b>
                              {marginText}
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
                    i.withholdingOverride || lineDiffersFromUsualPicks(linePicks, i.kind, { rate: i.withholdingRate, atc: i.withholdingAtc });
                  const pickUsual = lineWithholdingFromPicks(linePicks, i.kind);
                  const pickChips = lineWithholdingChipsFromPicks(linePicks, i.kind);
                  const usePickChips = !showOverride && pickChips.length > 0;
                  const displayAtc = showOverride ? i.withholdingAtc : pickUsual.atc;
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
                              onChange={(ev) => setItem(i.key, { supplierUnitCost: formatMoneyInput(ev.target.value) })}
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
                            onChange={(ev) => setItem(i.key, { unitPrice: formatMoneyInput(ev.target.value) })}
                          />
                        </div>
                        <div className="quote-line-card-total num strong">{formatPeso(a.total)}</div>
                      </div>
                      <div className="quote-line-card-meta">
                        {withCosts ? <span>{supplierCostMissing(i.supplierUnitCost) ? COST_NOT_SET_LABEL : `Margin ${formatPeso(a.margin)}`}</span> : null}
                        {usePickChips ? (
                          <span className="quote-line-card-wh-chips">
                            {pickChips.map((chip) => (
                              <span
                                key={`m-${i.key}-${chip.code}`}
                                className="quote-tg quote-tg-wh is-chip"
                                title={chip.atc ?? undefined}
                                aria-label={`Line ${idx + 1} ${chip.chipLabel}`}
                              >
                                {chip.chipLabel}
                              </span>
                            ))}
                          </span>
                        ) : (
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
                            <input
                              aria-label={`Line ${idx + 1} ATC`}
                              className="w-atc"
                              value={displayAtc ?? ""}
                              placeholder="ATC"
                              title={displayAtc ?? undefined}
                              onChange={(ev) => changeLineWithholding(i.key, { withholdingAtc: ev.target.value || null })}
                            />
                          </span>
                        )}
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
                    <div className={`totals-row strong${totals.supplierCostState !== "none" && Number(totals.netMargin) < 0 ? " neg" : ""}`}>
                      <span>{totals.supplierCostState === "partial" ? "Margin so far" : INTERNAL_MARGIN_LABEL}</span>
                      <span className="num">
                        {totals.supplierCostState === "none" ? (
                          COST_NOT_SET_LABEL
                        ) : (
                          <>
                            {formatPeso(totals.netMargin)}{" "}
                            <span className="muted">
                              ({Number(totals.netMarginPct).toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 0 })}%)
                            </span>
                          </>
                        )}
                      </span>
                    </div>
                    <div className="totals-row">
                      <span>{INTERNAL_CASH_AFTER_WH_LABEL}</span>
                      <span className="num">{formatPeso(totals.netReceived)}</span>
                    </div>
                  </div>
                )}
                <div className="wh-internal-panel">
                  <div className="wh-internal-panel-label">{WITHHOLDING_INTERNAL_PANEL_LABEL}</div>
                  <div className="quote-tbox totals-box" aria-label="Customer totals">
                    <div className="totals-row">
                      <span>Subtotal</span>
                      <span className="num">{formatPeso(totals.contractPrice)}</span>
                    </div>
                    <div className="totals-row strong">
                      <span>Contract price</span>
                      <span className="num">{formatPeso(totals.contractPrice)}</span>
                    </div>
                    {totals.withholding.map((w) => (
                      <div className="totals-row" key={w.code}>
                        <span>
                          {w.label}
                          {w.pctLabel ? ` (${w.pctLabel})` : ""}
                        </span>
                        <span className="num">−{formatPeso(w.amount)}</span>
                      </div>
                    ))}
                    <div className="totals-row">
                      <span>Less withholding (est.)</span>
                      <span className="num">{Number(totals.withholdingTotal) ? `−${formatPeso(totals.withholdingTotal)}` : formatPeso(0)}</span>
                    </div>
                    <div className="totals-row strong">
                      <span>{INTERNAL_CASH_AFTER_WH_LABEL}</span>
                      <span className="num">{formatPeso(totals.netReceived)}</span>
                    </div>
                    <div className="small faint" style={{ marginTop: 8 }}>
                      {amountInWords(totals.contractPrice)}
                    </div>
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
                <label htmlFor="deliveryNotes">Delivery</label>
                <textarea
                  id="deliveryNotes"
                  rows={2}
                  value={h.deliveryNotes || printDefaults.deliveryNotes || ""}
                  onChange={(ev) => setH({ ...h, deliveryNotes: ev.target.value })}
                />
                {e.deliveryNotes && <div className="error">{e.deliveryNotes}</div>}
                <div className="hint">Filled from Settings, edit for this quote · Prints on the quote</div>
              </div>
              <div className="quote-f quote-f-w2 field">
                <label htmlFor="warrantyNotes">Warranty</label>
                <textarea
                  id="warrantyNotes"
                  rows={2}
                  value={h.warrantyNotes || printDefaults.warrantyNotes || ""}
                  onChange={(ev) => setH({ ...h, warrantyNotes: ev.target.value })}
                />
                {e.warrantyNotes && <div className="error">{e.warrantyNotes}</div>}
                <div className="hint">Filled from Settings, edit for this quote · Prints on the quote</div>
              </div>
              <div className="quote-f field">
                <span className="label">Validity</span>
                <div>{derivedDays != null && derivedDays >= 0 ? `${derivedDays} ${derivedDays === 1 ? "day" : "days"}` : "—"}</div>
              </div>
              <div className="quote-f field full">
                <span className="label">Terms &amp; conditions</span>
                <textarea readOnly rows={4} value={printDefaults.quoteTerms ?? ""} aria-readonly />
                <div className="hint">From Settings · Read-only in Phase 1</div>
              </div>
              <div className="quote-f field full">
                <label htmlFor="termsRemarks">Remarks</label>
                <textarea id="termsRemarks" rows={3} value={h.notes} onChange={(ev) => setH({ ...h, notes: ev.target.value })} />
                <div className="hint">Customer sees this · Prints on the quote (same as Notes on the Notes tab)</div>
              </div>
              <div className="quote-f field full">
                <span className="label">Full terms</span>
                <div>
                  See the full terms at <a href="https://haciensolutions.com/policies" target="_blank" rel="noopener noreferrer">haciensolutions.com/policies</a> — the printed quote also carries them as a QR code.
                </div>
              </div>


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
            <button className="btn btn-secondary" type="submit" disabled={busy || !h.customerId || Object.keys(whPctErrors).length > 0 || hasValidityError}>
              {pending ? "Saving…" : "Save draft"}
            </button>
            {canMarkSent ? (
              <button type="button" className="btn" disabled={busy || !h.customerId || Object.keys(whPctErrors).length > 0 || hasValidityError} onClick={submitMarkSent}>
                {sentPending ? "Sending…" : "Mark as sent"}
              </button>
            ) : approvalStatus === "PENDING" || approvalStatus === "REJECTED" ? (
              <span className="small muted" style={{ alignSelf: "center" }}>
                {approvalStatus === "REJECTED" ? "Rejected — save edits to wait for approval" : "Waiting for approval"}
              </span>
            ) : null}
          </div>
        </div>
      </form>

      <AddCustomerDialog open={addCustomerOpen} onClose={() => setAddCustomerOpen(false)} onSaved={onCustomerCreated} rates={rates} terms={termsOptions} />

      <ConfirmDialog
        open={costConfirmOpen}
        title={COST_NOT_SET_LABEL}
        body="One or more lines have no supplier cost. Margin will show Cost not set until you enter it. Save anyway?"
        confirmLabel="Save anyway"
        cancelLabel="Go back"
        onCancel={() => setCostConfirmOpen(false)}
        onConfirm={confirmCostAnyway}
      />

      <ConfirmDialog
        open={noneConfirmOpen}
        title={WITHHOLDING_NONE_CONFIRM_TITLE}
        body="No rates are picked. Save as none, or go back and pick rates."
        confirmLabel={WITHHOLDING_NONE_CONFIRM_YES}
        cancelLabel={WITHHOLDING_NONE_CONFIRM_PICK}
        onCancel={() => setNoneConfirmOpen(false)}
        onConfirm={confirmNoneAndMarkSent}
      />

      {/* S-79: same prompt, wording and choices as Mark as sent, for Save draft. */}
      <ConfirmDialog
        open={saveNoneConfirmOpen}
        title={WITHHOLDING_NONE_CONFIRM_TITLE}
        body="No rates are picked. Save as none, or go back and pick rates."
        confirmLabel={WITHHOLDING_NONE_CONFIRM_YES}
        cancelLabel={WITHHOLDING_NONE_CONFIRM_PICK}
        onCancel={() => setSaveNoneConfirmOpen(false)}
        onConfirm={confirmSaveNone}
      />
    </>
  );
}

function hasNonEmptyPicks(picks: WithholdingSnapshot[] | null): boolean {
  return Array.isArray(picks) && picks.length > 0;
}
