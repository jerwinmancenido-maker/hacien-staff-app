"use client";

// Quote-only editor (Brief 09 Phase 1 + Brief 10 manual withholding picks).
// Style hooks (CSS added separately):
// quote-editor, quote-details-card, quote-meta-chip, quote-tabs, quote-tab, quote-tab-on,
// quote-trow, quote-int2, quote-tbox, edit-topbar, quote-fg, quote-f, quote-f-w2, quote-f-w3

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { useFormAction } from "@/components/useFormAction";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { WithholdingPickField } from "@/components/WithholdingPickField";
import { amountInWords } from "@/lib/print/amount-in-words";
import {
  COST_NOT_SET_LABEL,
  componentsTotal,
  docTotals,
  fromScaled,
  lineAmounts,
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
  withholdingPickBoxesHidden,
  allowGovVatOption,
  WITHHOLDING_DEFAULT_CODES,
} from "@/lib/quotes/withholding-defaults";
import { customerWithholdingHint } from "@/lib/quotes/customer-withholding-hint";
import { costIsEmpty, lastCostHint, pickSupplierCost, type SupplierCostRow } from "@/lib/quotes/last-cost";
import { applyLotToggle, lotNumberOf, lotTargets, moveComponentOut, moveComponentToLot, moveLineIntoLot } from "@/lib/quotes/lot-moves";
import { parseWithholdingPercentInput } from "@/lib/quotes/withholding-percent";
import { formatMoneyInput, formatPeso } from "@/lib/format";
import type { FormState } from "@/lib/validation/forms";
import { QuoteStatusChip } from "./DocParts";
import { AddCustomerDialog } from "./AddCustomerDialog";
import { SearchPicker } from "@/components/SearchPicker";
import { AddSupplierDialog } from "@/components/purchasing/AddSupplierDialog";
import type { CreatedInlineSupplier } from "@/app/(app)/suppliers/actions";
import { AddContactDialog } from "./AddContactDialog";
import {
  type EditorAddressOption,
  type EditorComponent,
  type EditorCustomer,
  type EditorInitial,
  type EditorItem,
} from "./DocumentEditor";
import { parseTypedValidityDays, validUntilFromDays, validityDaysFromDates } from "@/lib/quotes/validity";
import { Modal } from "./Dialogs";
import type { CatalogSearchResult } from "@/lib/items/search";

export type { EditorCustomer, EditorInitial, EditorItem };

type QuoteEditorInitial = EditorInitial & {
  internalNotes?: string;
  /** S-69: per-quote delivery/warranty notes; undefined = Settings default. */
  deliveryNotes?: string | null;
  warrantyNotes?: string | null;
  /** Modular terms: estimated lead time in business days (point 3). Null = no figure. */
  leadTimeDays?: number | null;
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
  /** Allowed contact roles from Settings → Lists (for the inline Add contact drawer). */
  contactRoles: string[];
  defaultValidityDays: number;
  printDefaults: { quoteTerms: string; deliveryNotes: string; warrantyNotes: string };
  /** Preparer picker (2026-11-07): staff users to choose from + the current preparer. */
  staffUsers: { id: string; name: string; position: string | null; hasSignature: boolean }[];
  preparedById: string;
  /** Delivery address pick (2026-11-08): the quote's stored pick, if any. */
  deliveryAddressId: string | null;
  /** Saves a new DELIVERY address to the customer; returns it for the picker. */
  addAddressAction: (
    customerId: string,
    input: { label: string; street: string; barangay: string; cityMunicipality: string; province: string; zip: string },
  ) => Promise<FormState & { address?: EditorAddressOption }>;
  /** S-70: approver + approval time. */
  approvedByName?: string | null;
  approvedAt?: string | null;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  cancelHref: string;
  markSentAction?: (id: string) => Promise<FormState>;
  /** Sets pick to [] then marks sent. Used when staff confirms "Yes, none". */
  confirmNoneAndMarkSentAction?: (id: string) => Promise<FormState>;
  /** S-18: only APPROVED quotes may mark as sent from the editor. */
  approvalStatus?: "PENDING" | "APPROVED" | "REJECTED";
};

type TabId = "items" | "withholding" | "terms" | "notes" | "signoff";

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
    itemId: null,
    itemName: null,
    newCatalog: null,
    isLot: false,
    components: [],
  };
}

function safeLine(i: EditorItem) {
  try {
    if (i.isLot) {
      // A lot is always qty 1 — the same rule the save planner applies
      // (lib/quotes/items.ts). Using the stored qty here would show one
      // total on screen while save writes another for a legacy lot whose
      // stored qty is not 1 (Bugbot, PR #175).
      const total = lineAmounts({ kind: i.kind, qty: "1", unitPrice: i.unitPrice || "0", supplierUnitCost: "0" }).total;
      const supplierTotal = componentsTotal((i.components ?? []).map((c) => ({ qty: c.qty || "0", unitCost: c.unitCost || "0" })));
      return { total, supplierTotal, margin: fromScaled(toScaled(total, 2) - toScaled(supplierTotal, 2), 2) };
    }
    return lineAmounts({ kind: i.kind, qty: i.qty || "0", unitPrice: i.unitPrice || "0", supplierUnitCost: i.supplierUnitCost || "0" });
  } catch {
    return { total: "0.00", supplierTotal: "0.00", margin: "0.00" };
  }
}

/** The save-warning / chip test, lot-aware: a lot is missing cost when it
 * has no components or any component has no cost yet. */
function lineCostMissing(i: EditorItem): boolean {
  if (i.isLot) {
    const comps = i.components ?? [];
    return comps.length === 0 || comps.some((c) => supplierCostMissing(c.unitCost));
  }
  return supplierCostMissing(i.supplierUnitCost);
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
  onKeyDown,
}: {
  label: string;
  value: string;
  onValue: (v: string) => void;
  onKeyDown?: (ev: KeyboardEvent<HTMLTextAreaElement>) => void;
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
      placeholder="Search by product name or SKU…"
      onChange={(ev) => {
        onValue(ev.target.value);
        growDesc(ev.target);
      }}
      onKeyDown={onKeyDown}
    />
  );
}

function customerTypeLabel(type: string): string {
  if (type === "GOVERNMENT") return "Government";
  if (type === "TOP_WITHHOLDING_AGENT") return "Top withholding agent";
  if (type === "NONE") return "No withholding";
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
    creditLimit: c.creditLimit ?? null,
    contacts: c.contacts,
    addresses: c.addresses,
    defaultDeliveryId: c.defaultDeliveryId ?? null,
    billingText: c.billingText ?? null,
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
  contactRoles,
  defaultValidityDays,
  printDefaults,
  staffUsers,
  preparedById,
  deliveryAddressId,
  addAddressAction,
  approvedByName = null,
  approvedAt = null,
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
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [noneConfirmOpen, setNoneConfirmOpen] = useState(false);
  /** S-79: same "No withholding on this quote?" confirm, for a draft save. */
  const [saveNoneConfirmOpen, setSaveNoneConfirmOpen] = useState(false);
  const [tab, setTab] = useState<TabId>("items");
  /** Preparer picker: the chosen staff user; the preview below follows it. */
  const [preparedByIdState, setPreparedByIdState] = useState(preparedById);
  const preparer = staffUsers.find((u) => u.id === preparedByIdState) ?? null;
  /** Delivery address pick: a saved-address id of the current customer, or
   * "" for no pick (print/conversion use the customer's default). */
  const [deliveryPick, setDeliveryPick] = useState(deliveryAddressId ?? "");
  const [addAddressOpen, setAddAddressOpen] = useState(false);
  /** Supplier options are local state so an inline-added supplier can join
   *  the list (and be picked on the line/component that asked for it). */
  const [supplierList, setSupplierList] = useState(suppliers);
  const [addSupplierOpen, setAddSupplierOpen] = useState(false);
  const supplierTargetRef = useRef<{ lineKey: string; compKey: string | null } | null>(null);
  // Client-only line keys for rows added after mount (initial keys are SSR-stable).
  const lineKeySeq = useRef(0);
  const allocLineKey = () => `n${++lineKeySeq.current}`;

  // S-82: after browser Back to a new quote, the browser can restore typed
  // values into the DOM while React state is fresh (empty), so the form
  // looks filled but Save stays greyed out on an empty customer. For a new
  // quote, reset the form on mount so what you see matches the state
  // (a preset ?customer= still shows, because reset restores the rendered
  // defaults, which come from the initial state).
  useLayoutEffect(() => {
    if (isNew) formRef.current?.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          itemId: i.itemId ?? null,
          itemName: i.itemName ?? null,
          newCatalog: null,
          isLot: i.isLot ?? false,
          components: (i.components ?? []).map((c, ci) => ({
            key: c.id ?? `init-c-${idx}-${ci}`,
            id: c.id ?? null,
            itemId: c.itemId,
            description: c.description,
            qty: c.qty,
            unit: c.unit,
            supplierId: c.supplierId,
            unitCost: c.unitCost,
          })),
        }))
      : [blankItem(initialPickSnaps, "init-0")],
  );
  const [reapplyWithholding, setReapplyWithholding] = useState(false);
  const [whPctErrors, setWhPctErrors] = useState<Record<string, string>>({});
  const [whPctDrafts, setWhPctDrafts] = useState<Record<string, string>>({});
  /** Expanded withholding checkboxes under Quote details (collapsed by default). */

  const initialDays =
    initial.validForDays != null
      ? String(initial.validForDays)
      : initial.validUntil && initial.date
        ? String(validityDaysFromDates(initial.date, initial.validUntil) ?? defaultValidityDays)
        : String(defaultValidityDays);
  const [validForDays, setValidForDays] = useState<string>(initialDays);

  // Modular terms: estimated lead time in business days (point 3). Blank = no figure.
  const [leadTimeDays, setLeadTimeDays] = useState<string>(initial.leadTimeDays != null ? String(initial.leadTimeDays) : "");
  // Terms tab: the Delivery/Warranty boxes collapse behind an Add button while
  // both are empty (owner call 2026-11-08 — empty boxes are confusing clutter).
  const [termsNotesOpen, setTermsNotesOpen] = useState(false);

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
  const deliveryWarrantyText = `${h.deliveryNotes || printDefaults.deliveryNotes || ""} ${h.warrantyNotes || printDefaults.warrantyNotes || ""}`.trim();
  const showDeliveryWarranty = termsNotesOpen || deliveryWarrantyText !== "" || !!e.deliveryNotes || !!e.warrantyNotes;
  const customer = customerList.find((c) => c.id === h.customerId);
  const pickedAddress = (customer?.addresses ?? []).find((a) => a.id === deliveryPick) ?? null;
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
  // S-67: the "withholding not set" banner must not show before a customer
  // is picked — with no customer there is nothing to warn about yet.
  const notSet = pick == null && customer != null;

  const setItem = (key: string, patch: Partial<EditorItem>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  // Catalog Step 3: product picker (search as you type) + product drawer.
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerResults, setPickerResults] = useState<CatalogSearchResult[]>([]);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [drawerFor, setDrawerFor] = useState<string | null>(null);
  const [drawerItem, setDrawerItem] = useState<CatalogSearchResult | null>(null);
  const [drawerBusy, setDrawerBusy] = useState(false);
  const pickerSeq = useRef(0);
  // Phase 1 compact lines: keyboard highlight in the picker, per-line
  // expanded "More" section, and catalog meta for the linked caption.
  const [pickerActive, setPickerActive] = useState(0);
  const [expandedLines, setExpandedLines] = useState<Record<string, boolean>>({});
  const [pickedMeta, setPickedMeta] = useState<Record<string, { sku: string | null; brand: string | null; model: string | null }>>({});
  const [costHints, setCostHints] = useState<Record<string, string>>({});
  const costCacheRef = useRef<Map<string, SupplierCostRow[]>>(new Map());
  const [compPicker, setCompPicker] = useState<{ lineKey: string; compKey: string; query: string; results: CatalogSearchResult[] } | null>(null);

  // The effect only fetches (state changes live in the async callback, never
  // in the effect body). Short queries clear their results where the query
  // is set instead — see onDescription.
  useEffect(() => {
    if (pickerFor == null) return;
    const q = pickerQuery.trim();
    if (q.length < 2) return;
    const seq = ++pickerSeq.current;
    const t = setTimeout(async () => {
      if (pickerSeq.current === seq) setPickerBusy(true);
      try {
        const res = await fetch(`/api/items/search?q=${encodeURIComponent(q)}`);
        const body = await res.json();
        if (pickerSeq.current !== seq) return;
        setPickerResults(body.ok && Array.isArray(body.items) ? body.items : []);
      } catch {
        if (pickerSeq.current === seq) setPickerResults([]);
      } finally {
        if (pickerSeq.current === seq) setPickerBusy(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [pickerFor, pickerQuery]);

  // Component catalog search: same endpoint + debounce as the line picker.
  useEffect(() => {
    if (!compPicker) return;
    const q = compPicker.query.trim();
    if (q.length < 2) return;
    const seq = ++pickerSeq.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/items/search?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { ok?: boolean; items?: CatalogSearchResult[] };
        if (pickerSeq.current !== seq) return;
        setCompPicker((p) => (p ? { ...p, results: data.ok && Array.isArray(data.items) ? data.items : [] } : p));
      } catch {
        if (pickerSeq.current === seq) setCompPicker((p) => (p ? { ...p, results: [] } : p));
      }
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compPicker?.query, compPicker?.lineKey, compPicker?.compKey]);

  /** Typing a description searches the catalog (unlinked lines only).
   * Lot lines skip it: their description is the printed spec text. */
  function onDescription(line: EditorItem, v: string) {
    setItem(line.key, { description: v });
    if (line.itemId || line.isLot) return;
    if (v.trim().length >= 2) {
      setPickerFor(line.key);
      setPickerQuery(v);
      setPickerActive(0);
    } else if (pickerFor === line.key) {
      setPickerFor(null);
      setPickerQuery("");
      setPickerResults([]);
    }
  }

  /** Picking a catalog item fills the line from it and links the line. */
  function applyCatalogPick(line: EditorItem, item: CatalogSearchResult) {
    setItems((xs) =>
      xs.map((x) => {
        if (x.key !== line.key) return x;
        const next: EditorItem = {
          ...x,
          itemId: item.id,
          itemName: item.name,
          description: item.name,
          unit: item.unit,
          newCatalog: null,
        };
        if (item.defaultUnitPrice != null) next.unitPrice = item.defaultUnitPrice;
        if (item.kind !== x.kind) {
          next.kind = item.kind;
          if (!x.withholdingOverride) {
            const wh = lineWithholdingSnapshotFromPicks(linePicks, item.kind);
            next.withholdingRate = wh.withholdingRate;
            next.withholdingAtc = wh.withholdingAtc;
            next.withholdingOverride = false;
          }
        }
        return next;
      }),
    );
    setPickedMeta((m) => ({ ...m, [line.key]: { sku: item.sku, brand: item.brand, model: item.model } }));
    if (line.supplierId) void maybeAutoFillCost({ ...line, description: item.name });
    setPickerFor(null);
    setPickerQuery("");
    setPickerResults([]);
    setPickerActive(0);
  }

  /** Lot plan Phase A: when a line has a supplier and a description but no
   * cost yet, fill the cost from that supplier's last PO for the same
   * description. Never overwrites a typed cost; silent with no history. */
  async function maybeAutoFillCost(line: EditorItem) {
    if (!withCosts || !line.supplierId) return;
    const description = line.description.trim();
    if (!description || !costIsEmpty(line.supplierUnitCost)) return;
    const supplierId = line.supplierId;
    try {
      let rows = costCacheRef.current.get(description);
      if (!rows) {
        const res = await fetch(`/api/items/supplier-costs?description=${encodeURIComponent(description)}`);
        const data = (await res.json()) as { ok?: boolean; rows?: SupplierCostRow[] };
        rows = data.ok && Array.isArray(data.rows) ? data.rows : [];
        costCacheRef.current.set(description, rows);
      }
      const row = pickSupplierCost(rows, supplierId);
      if (!row) return;
      setCostHints((h) => ({ ...h, [line.key]: lastCostHint(row) }));
      setItems((xs) =>
        xs.map((x) =>
          x.key === line.key && x.supplierId === supplierId && costIsEmpty(x.supplierUnitCost)
            ? { ...x, supplierUnitCost: row.lastCost }
            : x,
        ),
      );
    } catch {
      // Auto-fill is a convenience: a failed lookup leaves the box as-is.
    }
  }

  function onSupplierPick(line: EditorItem, supplierId: string | null) {
    setItem(line.key, { supplierId });
    if (supplierId) void maybeAutoFillCost({ ...line, supplierId });
  }

  // ---- Lot (bundle) components -------------------------------------------

  function blankComponent(): EditorComponent {
    return { key: allocLineKey(), id: null, itemId: null, description: "", qty: "1", unit: "pc", supplierId: null, unitCost: "" };
  }

  function toggleLot(line: EditorItem, on: boolean) {
    setItems((xs) => xs.map((x) => (x.key === line.key ? applyLotToggle(x, on, blankComponent) : x)));
  }

  // ---- Lot grouping: select items into lots (2026-11-09) -----------------

  function onMoveLineToLot(line: EditorItem, lotKey: string) {
    if (!lotKey) return;
    setItems((xs) => moveLineIntoLot(xs, line.key, lotKey));
  }

  function onMoveComponent(line: EditorItem, comp: EditorComponent, target: string) {
    if (!target) return;
    if (target === "__out__") {
      setItems((xs) =>
        moveComponentOut(xs, line.key, comp.key, (c) => {
          const wh = lineWithholdingSnapshotFromPicks(linePicks, line.kind);
          return {
            ...blankItem(linePicks, allocLineKey()),
            kind: line.kind,
            withholdingRate: wh.withholdingRate,
            withholdingAtc: wh.withholdingAtc,
            itemId: c.itemId,
            itemName: c.itemId ? c.description : null,
            description: c.description,
            qty: c.qty,
            unit: c.unit,
            supplierId: c.supplierId,
            supplierUnitCost: c.unitCost,
          };
        }),
      );
    } else {
      setItems((xs) => moveComponentToLot(xs, line.key, comp.key, target));
    }
  }

  function setComponent(lineKey: string, compKey: string, patch: Partial<EditorComponent>) {
    setItems((xs) =>
      xs.map((x) =>
        x.key === lineKey
          ? { ...x, components: (x.components ?? []).map((c) => (c.key === compKey ? { ...c, ...patch } : c)) }
          : x,
      ),
    );
  }

  function addComponent(line: EditorItem) {
    setItems((xs) => xs.map((x) => (x.key === line.key ? { ...x, components: [...(x.components ?? []), blankComponent()] } : x)));
  }

  function removeComponent(lineKey: string, compKey: string) {
    setItems((xs) =>
      xs.map((x) => (x.key === lineKey ? { ...x, components: (x.components ?? []).filter((c) => c.key !== compKey) } : x)),
    );
  }

  /** Phase A auto-fill, per component: same last-PO-cost lookup as lines. */
  async function maybeAutoFillComponentCost(line: EditorItem, comp: EditorComponent) {
    if (!withCosts || !comp.supplierId) return;
    const description = comp.description.trim();
    if (!description || !costIsEmpty(comp.unitCost)) return;
    const supplierId = comp.supplierId;
    try {
      let rows = costCacheRef.current.get(description);
      if (!rows) {
        const res = await fetch(`/api/items/supplier-costs?description=${encodeURIComponent(description)}`);
        const data = (await res.json()) as { ok?: boolean; rows?: SupplierCostRow[] };
        rows = data.ok && Array.isArray(data.rows) ? data.rows : [];
        costCacheRef.current.set(description, rows);
      }
      const row = pickSupplierCost(rows, supplierId);
      if (!row) return;
      setCostHints((h) => ({ ...h, [`${line.key}:${comp.key}`]: lastCostHint(row) }));
      setItems((xs) =>
        xs.map((x) =>
          x.key === line.key
            ? {
                ...x,
                components: (x.components ?? []).map((c) =>
                  c.key === comp.key && c.supplierId === supplierId && costIsEmpty(c.unitCost) ? { ...c, unitCost: row.lastCost } : c,
                ),
              }
            : x,
        ),
      );
    } catch {
      // Auto-fill is a convenience: a failed lookup leaves the box as-is.
    }
  }

  function onComponentSupplierPick(line: EditorItem, comp: EditorComponent, supplierId: string | null) {
    setComponent(line.key, comp.key, { supplierId });
    if (supplierId) void maybeAutoFillComponentCost(line, { ...comp, supplierId });
  }

  function applyComponentPick(line: EditorItem, comp: EditorComponent, item: CatalogSearchResult) {
    setComponent(line.key, comp.key, { itemId: item.id, description: item.name, unit: item.unit });
    setCompPicker(null);
    void maybeAutoFillComponentCost(line, { ...comp, itemId: item.id, description: item.name });
  }

  async function openDrawer(line: EditorItem) {
    setDrawerFor(line.key);
    if (!line.itemId) {
      setDrawerItem(null);
      // 2026-11-09 (Jerwin): opening "Add to Products" IS the intent — mark
      // the line so saving the quote creates the catalog item even if every
      // drawer field stays blank. Free-text lines never open the drawer and
      // stay out of the catalog.
      if (line.newCatalog == null) {
        setItem(line.key, { newCatalog: { brand: "", model: "", category: "", sku: "", details: "" } });
      }
      return;
    }
    setDrawerBusy(true);
    try {
      const res = await fetch(`/api/items/${line.itemId}`);
      const body = await res.json();
      setDrawerItem(body.ok ? body.item : null);
    } catch {
      setDrawerItem(null);
    } finally {
      setDrawerBusy(false);
    }
  }

  function closePicker() {
    setPickerFor(null);
    setPickerQuery("");
    setPickerResults([]);
    setPickerActive(0);
  }

  /** Picker keyboard flow: ↑/↓ move the highlight, Enter picks, Esc closes. */
  function onDescKeyDown(line: EditorItem, ev: KeyboardEvent<HTMLTextAreaElement>) {
    if (line.itemId || pickerFor !== line.key) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      closePicker();
      return;
    }
    if (pickerResults.length === 0) return;
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setPickerActive((a) => (a + 1) % pickerResults.length);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setPickerActive((a) => (a - 1 + pickerResults.length) % pickerResults.length);
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      const r = pickerResults[pickerActive] ?? pickerResults[0];
      if (r) applyCatalogPick(line, r);
    }
  }

  /** Focus the (visible) description box of line idx — desktop and mobile
   *  branches both render one, so pick the one on screen. */
  function focusLineDesc(idx: number) {
    const root = formRef.current;
    if (!root) return;
    const areas = [...root.querySelectorAll<HTMLTextAreaElement>("textarea.quote-desc")].filter((el) => el.offsetParent !== null);
    const el = areas[idx];
    if (el) {
      el.focus();
      el.scrollIntoView({ block: "center" });
    }
  }

  /** Enter on a price field jumps to the next line's search box, adding a
   *  fresh line first when the last line already has text. */
  function onPriceKeyDown(idx: number, ev: KeyboardEvent<HTMLInputElement>) {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    if (idx === items.length - 1 && items[idx]!.description.trim() !== "") {
      setItems((xs) => [...xs, blankItem(linePicks, allocLineKey())]);
    }
    requestAnimationFrame(() => focusLineDesc(idx + 1));
  }

  /** The search dropdown under a line's description (desktop + mobile share
   *  it). Two-line results: name + price, then SKU · brand · model · unit. */
  function pickerBox(line: EditorItem) {
    if (pickerFor !== line.key) return null;
    const q = pickerQuery.trim();
    return (
      <div className="quote-picker" role="listbox" aria-label="Catalog matches">
        {pickerBusy ? (
          <div className="small muted">Searching the catalog…</div>
        ) : pickerResults.length === 0 ? (
          <div className="small muted">No product found for “{q}” — this saves as a free-text line.</div>
        ) : (
          <ul className="plain-list">
            {pickerResults.map((r, ix) => {
              const rest = [r.brand, r.model, r.unit].filter(Boolean).join(" · ");
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    className={`quote-picker-opt${ix === pickerActive ? " is-active" : ""}`}
                    role="option"
                    aria-selected={ix === pickerActive}
                    onMouseEnter={() => setPickerActive(ix)}
                    onClick={() => applyCatalogPick(line, r)}
                  >
                    <span className="quote-picker-name">
                      <span>{r.name}</span>
                      {r.defaultUnitPrice != null ? (
                        <span className="num">₱{Number(r.defaultUnitPrice).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</span>
                      ) : null}
                    </span>
                    {r.sku || rest ? (
                      <span className="quote-picker-meta">
                        {r.sku ? (
                          <>
                            SKU <b>{r.sku}</b>
                            {rest ? " · " : ""}
                          </>
                        ) : null}
                        {rest}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {q ? (
          <button
            type="button"
            className="quote-picker-add"
            onClick={() => {
              closePicker();
              void openDrawer(line);
            }}
          >
            + Add to Products
          </button>
        ) : null}
        <button type="button" className="btn-link small" onClick={closePicker}>
          Close
        </button>
      </div>
    );
  }

  /** Quiet caption under the search box: a linked product, or a product that
   *  will be added to the catalog when the quote saves. Plain free-text
   *  lines show nothing — the search box itself is the whole control. */
  function productMeta(line: EditorItem) {
    if (line.itemId) {
      const meta = pickedMeta[line.key];
      const metaText = meta ? [meta.sku ? `SKU ${meta.sku}` : null, meta.brand, meta.model].filter(Boolean).join(" · ") : "";
      return (
        <div className="quote-ln-meta-line">
          <button type="button" className="btn-link quote-linked" onClick={() => openDrawer(line)}>
            🔗 Linked · {line.itemName ?? "Linked product"}
            {metaText ? ` · ${metaText}` : ""}
          </button>
          <button
            type="button"
            className="btn-link danger"
            aria-label="Unlink product"
            onClick={() => {
              setItem(line.key, { itemId: null, itemName: null });
              setPickedMeta((m) => {
                const next = { ...m };
                delete next[line.key];
                return next;
              });
            }}
          >
            ✕
          </button>
        </div>
      );
    }
    if (line.newCatalog) {
      return (
        <div className="quote-ln-meta-line">
          <button type="button" className="btn-link quote-linked" onClick={() => openDrawer(line)}>
            + New product — will be added to Products when saved{line.newCatalog.sku ? ` · SKU ${line.newCatalog.sku}` : ""}
          </button>
        </div>
      );
    }
    return null;
  }
  const move = (idx: number, by: number) =>
    setItems((xs) => {
      const next = [...xs];
      const [it] = next.splice(idx, 1);
      next.splice(Math.max(0, Math.min(next.length, idx + by)), 0, it!);
      return next;
    });
  // Deleting is always allowed (owner call, 2026-11-08): removing the last
  // remaining line swaps in a fresh blank line, so the editor never sits at
  // zero lines and a wrong product can always be cleared.
  const removeItem = (line: EditorItem) =>
    setItems((xs) => (xs.length === 1 ? [blankItem(linePicks, allocLineKey())] : xs.filter((x) => x.key !== line.key)));

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
    // Re-picking the customer already on the quote is a no-op: the reset
    // below would wipe the contact, delivery pick and terms the staffer
    // already set (CTO fix 2026-11-09).
    if (id === h.customerId) return;
    const c = customerList.find((x) => x.id === id);
    // The delivery pick belongs to the customer: reset to the new
    // customer's default delivery address (or no pick).
    setDeliveryPick(c?.defaultDeliveryId ?? "");
    applyPickDefaults(c?.defaultWithholding ?? null, items, {
      customerId: id,
      contactId: c?.contacts.find((k) => k.isMain)?.id ?? "",
      terms: c?.defaultTerms ?? h.terms,
    });
  }

  function onCustomerSelect(id: string) {
    pickCustomer(id);
  }

  function onCustomerCreated(c: EditorCustomer | (Omit<EditorCustomer, "defaultWithholding"> & { defaultWithholding?: string[] | null })) {
    const ec = toEditorCustomer(c);
    setCustomerList((xs) => (xs.some((x) => x.id === ec.id) ? xs : [...xs, ec]));
    setDeliveryPick(ec.defaultDeliveryId ?? "");
    applyPickDefaults(ec.defaultWithholding ?? null, items, {
      customerId: ec.id,
      contactId: ec.contacts.find((k) => k.isMain)?.id ?? "",
      terms: ec.defaultTerms ?? h.terms,
    });
  }

  function onDeliverySelect(value: string) {
    setDeliveryPick(value);
  }

  /** A just-saved contact joins the picked customer's list and is selected.
   * If it became the main contact, the local main flags follow the server. */
  function onContactAdded(c: { id: string; name: string; isMain: boolean }) {
    setCustomerList((xs) =>
      xs.map((x) =>
        x.id === h.customerId
          ? { ...x, contacts: [...x.contacts.map((k) => (c.isMain ? { ...k, isMain: false } : k)), c] }
          : x,
      ),
    );
    setH((v) => ({ ...v, contactId: c.id }));
  }

  /** A just-saved address joins the current customer's options (delivery
   * first, like the server sort) and becomes the pick. */
  function onAddressAdded(a: EditorAddressOption) {
    setCustomerList((xs) =>
      xs.map((c) =>
        c.id === h.customerId
          ? { ...c, addresses: [...(c.addresses ?? []), a].sort((x, y) => Number(y.kind === "DELIVERY") - Number(x.kind === "DELIVERY")) }
          : c,
      ),
    );
    setDeliveryPick(a.id);
    setAddAddressOpen(false);
  }

  /** The "+ Add supplier" row inside a line/component supplier picker:
   *  remember which line (or component) asked, then open the drawer. */
  function openAddSupplier(lineKey: string, compKey: string | null) {
    supplierTargetRef.current = { lineKey, compKey };
    setAddSupplierOpen(true);
  }

  /** A just-saved supplier joins the list and is picked on the line or
   *  component that asked for it (cost auto-fill follows the pick). */
  function onSupplierCreated(created: CreatedInlineSupplier) {
    const entry = { id: created.id, name: created.name };
    setSupplierList((xs) => (xs == null || xs.some((x) => x.id === entry.id) ? xs : [...xs, entry].sort((a, b) => a.name.localeCompare(b.name))));
    const target = supplierTargetRef.current;
    supplierTargetRef.current = null;
    if (!target) return;
    const line = items.find((x) => x.key === target.lineKey);
    if (!line) return;
    if (target.compKey == null) {
      onSupplierPick(line, created.id);
    } else {
      const comp = (line.components ?? []).find((c) => c.key === target.compKey);
      if (comp) onComponentSupplierPick(line, comp, created.id);
    }
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
    const nc = i.newCatalog;
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
      itemId: i.itemId,
      // The marker goes whenever the drawer marked the line (2026-11-09):
      // blank fields still create the item on save.
      newCatalog: nc
        ? { brand: nc.brand, model: nc.model, category: nc.category, sku: nc.sku, details: nc.details }
        : undefined,
    };
    if (!withCosts) return base;
    return {
      ...base,
      supplierId: i.supplierId,
      supplierUnitCost: i.supplierUnitCost || "0",
      isLot: i.isLot === true,
      components:
        i.isLot === true
          ? (i.components ?? []).map((c) => ({
              id: c.id,
              itemId: c.itemId,
              description: c.description,
              qty: c.qty,
              unit: c.unit,
              supplierId: c.supplierId,
              unitCost: c.unitCost || "0",
            }))
          : undefined,
    };
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
    leadTimeDays: leadTimeDays.trim() === "" ? undefined : leadTimeDays.trim(),
    internalNotes: h.internalNotes,
    subject: h.subject,
    buyerPoNo: h.buyerPoNo,
    // Preparer picker: who prepared this quote (prints under "Prepared by").
    preparedById: preparedByIdState,
    // Delivery address pick: a saved-address id, or null for no pick.
    deliveryAddressId: deliveryPick || null,
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
    Boolean(leadTimeDays.trim()) ||
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
      supplierCostMissing: !skipCostWarn.current && withCosts && items.some(lineCostMissing),
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
        supplierCostMissing: withCosts && items.some(lineCostMissing),
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

        <div className="edit-topbar">
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
            <div className={`quote-f field${e.customerId ? " has-error" : ""}`}>
              <label htmlFor="customerId">
                Customer<span className="req"> *</span>
              </label>
              <SearchPicker
                id="customerId"
                ariaLabel="Customer"
                value={h.customerId}
                options={customerList.map((c) => ({ id: c.id, label: c.name }))}
                placeholder="Pick a customer…"
                onPick={onCustomerSelect}
                addLabel="Add customer"
                onAdd={() => setAddCustomerOpen(true)}
              />
              {customer && (
                <div className="hint">
                  {[customerTypeLabel(customer.withholdingType), quotePickHint].filter(Boolean).join(" · ")}
                </div>
              )}
              {e.customerId && <div className="error">{e.customerId}</div>}
            </div>
            <div className={`quote-f field${e.contactId ? " has-error" : ""}`}>
              <label htmlFor="contactId">Contact</label>
              <SearchPicker
                id="contactId"
                ariaLabel="Contact"
                value={h.contactId}
                options={contacts.map((c) => ({ id: c.id, label: c.name, meta: c.isMain ? "Main contact" : undefined }))}
                placeholder="Pick a contact…"
                emptyOptionLabel="None"
                disabled={!customer}
                onPick={(id) => setH({ ...h, contactId: id })}
                addLabel="Add contact"
                onAdd={() => setAddContactOpen(true)}
              />
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
            <div className={`quote-f field${e.buyerPoNo ? " has-error" : ""}`}>
              <label htmlFor="buyerPoNo">Customer PO / RFQ no.</label>
              <input id="buyerPoNo" type="text" value={h.buyerPoNo} onChange={(ev) => setH({ ...h, buyerPoNo: ev.target.value })} />
              {e.buyerPoNo && <div className="error">{e.buyerPoNo}</div>}
            </div>
            <div className={`quote-f field full${e.subject ? " has-error" : ""}`}>
              <label htmlFor="subject">Subject / project</label>
              <input id="subject" type="text" value={h.subject} onChange={(ev) => setH({ ...h, subject: ev.target.value })} />
              {e.subject && <div className="error">{e.subject}</div>}
              {items.some((i) => i.isLot) ? <div className="hint">For a lot, the lot&apos;s name belongs in this Subject — it does not print in the items table.</div> : null}
            </div>
            <div className={`quote-f field full${e.deliveryAddressId ? " has-error" : ""}`}>
              <label htmlFor="deliveryAddressId">Delivery address</label>
              <SearchPicker
                id="deliveryAddressId"
                ariaLabel="Delivery address"
                value={deliveryPick}
                options={(customer?.addresses ?? []).map((a) => ({ id: a.id, label: a.label, meta: a.oneLine }))}
                placeholder="Pick a delivery address…"
                emptyOptionLabel="Customer default — decide at conversion"
                disabled={!customer}
                onPick={onDeliverySelect}
                addLabel="Add address"
                onAdd={() => setAddAddressOpen(true)}
              />
              {pickedAddress ? (
                <div className="hint" style={{ whiteSpace: "pre-line" }}>
                  {pickedAddress.text}
                </div>
              ) : (
                customer && <div className="hint">Prints the customer&apos;s default delivery address.</div>
              )}
              {customer?.billingText && <div className="hint">Billing: {customer.billingText.split("\n").join(", ")}</div>}
              {e.deliveryAddressId && <div className="error">{e.deliveryAddressId}</div>}
            </div>
            {/* No withholding row here: withholding lives only in its tab
                (owner call 2026-11-08). Pick errors still surface as the
                Withholding tab's dot and inside the tab itself. */}
          </div>
        </div>

        <div className="card">
          <div className="quote-tabs-wrap">
            <div className="quote-tabs" role="tablist" aria-label="Quote sections">
              <button type="button" role="tab" aria-selected={tab === "items"} className={`quote-tab${tab === "items" ? " quote-tab-on" : ""}`} onClick={() => setTab("items")}>
                Items
                {items.length > 0 ? <span className="quote-tab-badge">{items.length}</span> : null}
              </button>
              <button type="button" role="tab" aria-selected={tab === "withholding"} className={`quote-tab${tab === "withholding" ? " quote-tab-on" : ""}`} onClick={() => setTab("withholding")}>
                Withholding
                {e.withholdingCodes || e.withholding ? <span className="quote-tab-dot" aria-hidden /> : null}
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
                  <span>Product — search by name or SKU</span>
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
                  const costMissing = lineCostMissing(i);
                  const below = !costMissing && toScaled(a.margin, 2) < 0n;
                  const marginPct = Number(a.total) !== 0 ? ((Number(a.margin) / Number(a.total)) * 100).toFixed(1) : "0.0";
                  const marginText = costMissing
                    ? COST_NOT_SET_LABEL
                    : below
                      ? `⚠ Price is below cost · ${formatPeso(a.margin)} · ${marginPct}%`
                      : `${formatPeso(a.margin)} · ${marginPct}%`;
                  const whLabel = pct ? `WHT ${pct}%` : "WHT —";
                  const expanded = expandedLines[i.key] ?? (showOverride || !!whPctErrors[i.key]);
                  return (
                    <div className="quote-ln" key={i.key}>
                      <div className="quote-lr">
                        <div className="quote-ln-no">{idx + 1}</div>
                        <div className="quote-ln-dsc">
                          <div className="quote-ln-descwrap">
                            <DescTextarea label={`Line ${idx + 1} description`} value={i.description} onValue={(v) => onDescription(i, v)} onKeyDown={(ev) => onDescKeyDown(i, ev)} />
                            {pickerBox(i)}
                          </div>
                          {productMeta(i)}
                          <div className="quote-ln-tags">
                            {usePickChips ? (
                              <>
                                <span className="quote-tg">{i.kind === "GOODS" ? "Goods" : "Services"}</span>
                                {pickChips.map((chip) => (
                                  <span
                                    key={`${i.key}-${chip.code}`}
                                    className="quote-tg quote-tg-wh is-chip"
                                    title={chip.atc ?? undefined}
                                    aria-label={`Line ${idx + 1} ${chip.chipLabel}`}
                                  >
                                    {chip.chipLabel}
                                  </span>
                                ))}
                              </>
                            ) : (
                              <span className="quote-tg quote-tg-wh">
                                {i.kind === "GOODS" ? "Goods" : "Services"} · {whLabel}
                                {displayAtc ? ` · ${displayAtc}` : ""}
                              </span>
                            )}
                            {withCosts ? (
                              costMissing ? (
                                <span className="quote-tg quote-tg-cost">Cost not set</span>
                              ) : below ? (
                                <span className="quote-tg quote-tg-cost neg">Below cost</span>
                              ) : (
                                <span className="quote-tg quote-tg-cost ok">Margin {marginPct}%</span>
                              )
                            ) : null}
                            {whPctErrors[i.key] ? <span className="error small">{whPctErrors[i.key]}</span> : null}
                          </div>
                        </div>
                        <div className="quote-ln-qty">
                          <input aria-label={`Line ${idx + 1} qty`} inputMode="decimal" value={i.qty} disabled={i.isLot === true} title={i.isLot ? "A lot is qty 1 — add another lot for a second bundle" : undefined} onChange={(ev) => setItem(i.key, { qty: ev.target.value })} />
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
                            onKeyDown={(ev) => onPriceKeyDown(idx, ev)}
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
                            className="btn-link"
                            aria-label={`Line ${idx + 1} details`}
                            aria-expanded={expanded}
                            onClick={() => setExpandedLines((m) => ({ ...m, [i.key]: !expanded }))}
                          >
                            {expanded ? "⌃" : "⌄"}
                          </button>
                          {withCosts && !i.isLot && lotTargets(items).length > 0 ? (
                            <select
                              className="quote-ln-move"
                              aria-label={`Move line ${idx + 1} into a lot`}
                              value=""
                              onChange={(ev) => onMoveLineToLot(i, ev.target.value)}
                            >
                              <option value="">Move to…</option>
                              {lotTargets(items).map((t) => (
                                <option key={t.key} value={t.key}>
                                  Lot {t.n}
                                </option>
                              ))}
                            </select>
                          ) : null}
                          <button
                            type="button"
                            className="btn-link danger"
                            aria-label={`Remove line ${idx + 1}`}
                            onClick={() => removeItem(i)}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      {expanded ? (
                        <div className="quote-ln-more">
                          <div className="quote-ln-more-row">
                            <div className="field">
                              <label className="label" htmlFor={`kind-${i.key}`}>
                                Kind
                              </label>
                              <select id={`kind-${i.key}`} aria-label={`Line ${idx + 1} kind`} value={i.kind} onChange={(ev) => changeKind(i.key, ev.target.value as ItemKind)}>
                                <option value="GOODS">Goods</option>
                                <option value="SERVICES">Services</option>
                              </select>
                            </div>
                            {usePickChips ? (
                              <p className="small muted quote-ln-more-note">Withholding comes from the customer&apos;s picks — see the Withholding tab.</p>
                            ) : (
                              <div className="field">
                                <label className="label" htmlFor={`whpct-${i.key}`}>
                                  Withholding
                                </label>
                                <span className="quote-tg quote-tg-wh" title={displayAtc ?? undefined}>
                                  <span className="quote-tg-wh-label">{whLabel}</span>
                                  <input
                                    id={`whpct-${i.key}`}
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
                                  <input
                                    aria-label={`Line ${idx + 1} ATC`}
                                    className="w-atc"
                                    value={displayAtc ?? ""}
                                    placeholder="ATC"
                                    title={displayAtc ?? undefined}
                                    onChange={(ev) => changeLineWithholding(i.key, { withholdingAtc: ev.target.value || null })}
                                  />
                                </span>
                              </div>
                            )}
                          </div>
                          {showOverride && <div className="small muted">{OVERRIDE_NOTE}</div>}
                          {whPctErrors[i.key] ? <div className="error small">{whPctErrors[i.key]}</div> : null}
                          {withCosts ? (
                            <div className="quote-ln-lotbar">
                              {i.isLot ? <span className="quote-lot-badge">LOT {lotNumberOf(items, i.key)}</span> : null}
                              <label className="small">
                                <input
                                  type="checkbox"
                                  aria-label={`Line ${idx + 1} lot bundle`}
                                  checked={i.isLot === true}
                                  onChange={(ev) => toggleLot(i, ev.target.checked)}
                                />{" "}
                                Lot (bundle) — items listed on the print under one lot price; cost comes from its components
                              </label>
                            </div>
                          ) : null}
                          {withCosts && i.isLot ? (
                            <div className="quote-ln-components">
                              <div className="small muted quote-ln-comp-hint">
                                Members carry cost only — the lot price above is the only selling price. A member&apos;s first description line prints as the part title; the lines under it print as specs. Moving a line into a lot drops its selling price and withholding pick — the lot&apos;s price and withholding apply.
                              </div>
                              {(i.components ?? []).map((c, cIdx) => (
                                <div className="quote-ln-comp" key={c.key}>
                                  <div className="field grow">
                                    <label className="label" htmlFor={`comp-desc-${c.key}`}>
                                      Component {cIdx + 1}
                                    </label>
                                    <textarea
                                      rows={3}
                                      id={`comp-desc-${c.key}`}
                                      aria-label={`Line ${idx + 1} component ${cIdx + 1} description`}
                                      value={c.description}
                                      placeholder="Product or service inside the lot"
                                      onChange={(ev) => {
                                        const v = ev.target.value;
                                        setComponent(i.key, c.key, { description: v, itemId: null });
                                        if (v.trim().length >= 2) {
                                          setCompPicker({ lineKey: i.key, compKey: c.key, query: v, results: compPicker && compPicker.compKey === c.key ? compPicker.results : [] });
                                        } else if (compPicker?.compKey === c.key) {
                                          setCompPicker(null);
                                        }
                                      }}
                                      onBlur={() => setTimeout(() => setCompPicker((p) => (p?.compKey === c.key ? null : p)), 150)}
                                    ></textarea>
                                    {compPicker && compPicker.lineKey === i.key && compPicker.compKey === c.key && compPicker.results.length > 0 ? (
                                      <div className="quote-picker" role="listbox" aria-label="Catalog matches">
                                        <ul className="plain-list">
                                          {compPicker.results.map((r) => {
                                            const rest = [r.sku ? `SKU ${r.sku}` : null, r.brand, r.model, r.unit].filter(Boolean).join(" · ");
                                            return (
                                              <li key={r.id}>
                                                <button type="button" className="quote-picker-opt" onClick={() => applyComponentPick(i, c, r)}>
                                                  <span className="quote-picker-name">
                                                    <span>{r.name}</span>
                                                  </span>
                                                  {rest ? <span className="quote-picker-meta">{rest}</span> : null}
                                                </button>
                                              </li>
                                            );
                                          })}
                                        </ul>
                                      </div>
                                    ) : null}
                                  </div>
                                  <div className="field">
                                    <label className="label" htmlFor={`comp-qty-${c.key}`}>
                                      Qty
                                    </label>
                                    <input
                                      id={`comp-qty-${c.key}`}
                                      aria-label={`Line ${idx + 1} component ${cIdx + 1} qty`}
                                      inputMode="decimal"
                                      value={c.qty}
                                      onChange={(ev) => setComponent(i.key, c.key, { qty: ev.target.value })}
                                    />
                                  </div>
                                  <div className="field">
                                    <label className="label" htmlFor={`comp-unit-${c.key}`}>
                                      Unit
                                    </label>
                                    <input
                                      id={`comp-unit-${c.key}`}
                                      aria-label={`Line ${idx + 1} component ${cIdx + 1} unit`}
                                      value={c.unit}
                                      onChange={(ev) => setComponent(i.key, c.key, { unit: ev.target.value })}
                                    />
                                  </div>
                                  <div className="field">
                                    <label className="label" htmlFor={`comp-sup-${c.key}`}>
                                      Supplier
                                    </label>
                                    <SearchPicker
                                      id={`comp-sup-${c.key}`}
                                      ariaLabel={`Line ${idx + 1} component ${cIdx + 1} supplier`}
                                      value={c.supplierId ?? ""}
                                      options={(supplierList ?? []).map((s) => ({ id: s.id, label: s.name }))}
                                      placeholder="Pick a supplier…"
                                      emptyOptionLabel="—"
                                      onPick={(id) => onComponentSupplierPick(i, c, id || null)}
                                      addLabel="Add supplier"
                                      onAdd={() => openAddSupplier(i.key, c.key)}
                                    />
                                  </div>
                                  <div className="field">
                                    <label className="label" htmlFor={`comp-cost-${c.key}`}>
                                      Unit cost
                                    </label>
                                    <input
                                      id={`comp-cost-${c.key}`}
                                      aria-label={`Line ${idx + 1} component ${cIdx + 1} unit cost`}
                                      inputMode="decimal"
                                      value={c.unitCost}
                                      onChange={(ev) => setComponent(i.key, c.key, { unitCost: formatMoneyInput(ev.target.value) })}
                                    />
                                    {costHints[`${i.key}:${c.key}`] ? <div className="hint">{costHints[`${i.key}:${c.key}`]}</div> : null}
                                  </div>
                                  <select
                                    className="quote-ln-move"
                                    aria-label={`Move component ${cIdx + 1} of line ${idx + 1} to another lot or out of the lot`}
                                    value=""
                                    onChange={(ev) => onMoveComponent(i, c, ev.target.value)}
                                  >
                                    <option value="">Move to…</option>
                                    {lotTargets(items, i.key).map((t) => (
                                      <option key={t.key} value={t.key}>
                                        Lot {t.n}
                                      </option>
                                    ))}
                                    <option value="__out__">Out of lot</option>
                                  </select>
                                  <button
                                    type="button"
                                    className="btn-link danger"
                                    aria-label={`Remove component ${cIdx + 1} from line ${idx + 1}`}
                                    onClick={() => removeComponent(i.key, c.key)}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                              <div className="quote-ln-comp-foot">
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => addComponent(i)}>
                                  Add component
                                </button>
                                <span className="small muted">
                                  Lot cost {formatPeso(a.supplierTotal)} · Margin {formatPeso(a.margin)}
                                </span>
                              </div>
                            </div>
                          ) : null}
                          {withCosts && !i.isLot ? (
                            <div className="quote-ln-more-row">
                              <div className="field grow">
                                <label className="label" htmlFor={`sup-${i.key}`}>
                                  Supplier (internal)
                                </label>
                                <SearchPicker
                                  id={`sup-${i.key}`}
                                  ariaLabel={`Line ${idx + 1} supplier`}
                                  value={i.supplierId ?? ""}
                                  options={(supplierList ?? []).map((s) => ({ id: s.id, label: s.name }))}
                                  placeholder="Pick a supplier…"
                                  emptyOptionLabel="—"
                                  onPick={(id) => onSupplierPick(i, id || null)}
                                  addLabel="Add supplier"
                                  onAdd={() => openAddSupplier(i.key, null)}
                                />
                              </div>
                              <div className="field">
                                <label className="label" htmlFor={`cost-${i.key}`}>
                                  Unit cost
                                </label>
                                <input
                                  id={`cost-${i.key}`}
                                  aria-label={`Line ${idx + 1} supplier unit cost`}
                                  inputMode="decimal"
                                  value={i.supplierUnitCost}
                                  onChange={(ev) => setItem(i.key, { supplierUnitCost: formatMoneyInput(ev.target.value) })}
                                />
                                {costHints[i.key] ? <div className="hint">{costHints[i.key]}</div> : null}
                              </div>
                              <div className="field">
                                <span className="label">Margin</span>
                                <span className={`quote-ln-margin${below ? " neg" : ""}`}>{marginText}</span>
                              </div>
                            </div>
                          ) : null}
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
                  const costMissing = lineCostMissing(i);
                  const below = !costMissing && toScaled(a.margin, 2) < 0n;
                  const marginPct = Number(a.total) !== 0 ? ((Number(a.margin) / Number(a.total)) * 100).toFixed(1) : "0.0";
                  const marginText = costMissing
                    ? COST_NOT_SET_LABEL
                    : below
                      ? `⚠ Price is below cost · ${formatPeso(a.margin)} · ${marginPct}%`
                      : `${formatPeso(a.margin)} · ${marginPct}%`;
                  const whLabel = pct ? `WHT ${pct}%` : "WHT —";
                  const expanded = expandedLines[i.key] ?? (showOverride || !!whPctErrors[i.key]);
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
                          className="btn-link"
                          aria-label={`Line ${idx + 1} details`}
                          aria-expanded={expanded}
                          onClick={() => setExpandedLines((m) => ({ ...m, [i.key]: !expanded }))}
                        >
                          {expanded ? "⌃" : "⌄"}
                        </button>
                        {withCosts && !i.isLot && lotTargets(items).length > 0 ? (
                          <select
                            className="quote-ln-move"
                            aria-label={`Move line ${idx + 1} into a lot`}
                            value=""
                            onChange={(ev) => onMoveLineToLot(i, ev.target.value)}
                          >
                            <option value="">Move to…</option>
                            {lotTargets(items).map((t) => (
                              <option key={t.key} value={t.key}>
                                Lot {t.n}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        <button
                          type="button"
                          className="btn-link danger"
                          aria-label={`Remove line ${idx + 1}`}
                          onClick={() => removeItem(i)}
                        >
                          ✕
                        </button>
                      </div>
                      <div className="quote-line-card-desc">
                        <div className="quote-ln-descwrap">
                          <DescTextarea label={`Line ${idx + 1} description`} value={i.description} onValue={(v) => onDescription(i, v)} onKeyDown={(ev) => onDescKeyDown(i, ev)} />
                          {pickerBox(i)}
                        </div>
                        {productMeta(i)}
                      </div>
                      <div className="quote-line-card-row3">
                        <div className="field">
                          <label className="sr-only" htmlFor={`m-qty-${i.key}`}>
                            Qty
                          </label>
                          <input
                            id={`m-qty-${i.key}`}
                            aria-label={`Line ${idx + 1} qty`}
                            inputMode="decimal"
                            disabled={i.isLot === true}
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
                            onKeyDown={(ev) => onPriceKeyDown(idx, ev)}
                          />
                        </div>
                        <div className="quote-line-card-total num strong">{formatPeso(a.total)}</div>
                      </div>
                      <div className="quote-line-card-meta">
                        {usePickChips ? (
                          <>
                            <span className="quote-tg">{i.kind === "GOODS" ? "Goods" : "Services"}</span>
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
                          </>
                        ) : (
                          <span className="quote-tg quote-tg-wh">
                            {i.kind === "GOODS" ? "Goods" : "Services"} · {whLabel}
                            {displayAtc ? ` · ${displayAtc}` : ""}
                          </span>
                        )}
                        {withCosts ? (
                          costMissing ? (
                            <span className="quote-tg quote-tg-cost">Cost not set</span>
                          ) : below ? (
                            <span className="quote-tg quote-tg-cost neg">Below cost</span>
                          ) : (
                            <span className="quote-tg quote-tg-cost ok">Margin {marginPct}%</span>
                          )
                        ) : null}
                        {whPctErrors[i.key] ? <span className="error small">{whPctErrors[i.key]}</span> : null}
                      </div>
                      {expanded ? (
                        <div className="quote-ln-more">
                          <div className="field">
                            <label className="label" htmlFor={`m-kind-${i.key}`}>
                              Kind
                            </label>
                            <select id={`m-kind-${i.key}`} aria-label={`Line ${idx + 1} kind`} value={i.kind} onChange={(ev) => changeKind(i.key, ev.target.value as ItemKind)}>
                              <option value="GOODS">Goods</option>
                              <option value="SERVICES">Services</option>
                            </select>
                          </div>
                          {usePickChips ? (
                            <p className="small muted">Withholding comes from the customer&apos;s picks — see the Withholding tab.</p>
                          ) : (
                            <div className="field">
                              <label className="label" htmlFor={`m-whpct-${i.key}`}>
                                Withholding
                              </label>
                              <span className="quote-line-card-wh">
                                WH%{" "}
                                <input
                                  id={`m-whpct-${i.key}`}
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
                            </div>
                          )}
                          {showOverride && <div className="small muted">{OVERRIDE_NOTE}</div>}
                          {whPctErrors[i.key] ? <div className="error small">{whPctErrors[i.key]}</div> : null}
                          {withCosts ? (
                            <div className="quote-ln-lotbar">
                              {i.isLot ? <span className="quote-lot-badge">LOT {lotNumberOf(items, i.key)}</span> : null}
                              <label className="small">
                                <input
                                  type="checkbox"
                                  aria-label={`Line ${idx + 1} lot bundle`}
                                  checked={i.isLot === true}
                                  onChange={(ev) => toggleLot(i, ev.target.checked)}
                                />{" "}
                                Lot (bundle) — items listed on the print under one lot price; cost comes from its components
                              </label>
                            </div>
                          ) : null}
                          {withCosts && i.isLot ? (
                            <div className="quote-ln-components">
                              <div className="small muted quote-ln-comp-hint">
                                Members carry cost only — the lot price above is the only selling price. A member&apos;s first description line prints as the part title; the lines under it print as specs. Moving a line into a lot drops its selling price and withholding pick — the lot&apos;s price and withholding apply.
                              </div>
                              {(i.components ?? []).map((c, cIdx) => (
                                <div className="quote-ln-comp" key={c.key}>
                                  <div className="field grow">
                                    <label className="label" htmlFor={`m-comp-desc-${c.key}`}>
                                      Component {cIdx + 1}
                                    </label>
                                    <textarea
                                      rows={3}
                                      id={`m-comp-desc-${c.key}`}
                                      aria-label={`Line ${idx + 1} component ${cIdx + 1} description`}
                                      value={c.description}
                                      placeholder="Product or service inside the lot"
                                      onChange={(ev) => {
                                        const v = ev.target.value;
                                        setComponent(i.key, c.key, { description: v, itemId: null });
                                        if (v.trim().length >= 2) {
                                          setCompPicker({ lineKey: i.key, compKey: c.key, query: v, results: compPicker && compPicker.compKey === c.key ? compPicker.results : [] });
                                        } else if (compPicker?.compKey === c.key) {
                                          setCompPicker(null);
                                        }
                                      }}
                                      onBlur={() => setTimeout(() => setCompPicker((p) => (p?.compKey === c.key ? null : p)), 150)}
                                    ></textarea>
                                    {compPicker && compPicker.lineKey === i.key && compPicker.compKey === c.key && compPicker.results.length > 0 ? (
                                      <div className="quote-picker" role="listbox" aria-label="Catalog matches">
                                        <ul className="plain-list">
                                          {compPicker.results.map((r) => {
                                            const rest = [r.sku ? `SKU ${r.sku}` : null, r.brand, r.model, r.unit].filter(Boolean).join(" · ");
                                            return (
                                              <li key={r.id}>
                                                <button type="button" className="quote-picker-opt" onClick={() => applyComponentPick(i, c, r)}>
                                                  <span className="quote-picker-name">
                                                    <span>{r.name}</span>
                                                  </span>
                                                  {rest ? <span className="quote-picker-meta">{rest}</span> : null}
                                                </button>
                                              </li>
                                            );
                                          })}
                                        </ul>
                                      </div>
                                    ) : null}
                                  </div>
                                  <div className="field">
                                    <label className="label" htmlFor={`m-comp-qty-${c.key}`}>
                                      Qty
                                    </label>
                                    <input
                                      id={`m-comp-qty-${c.key}`}
                                      aria-label={`Line ${idx + 1} component ${cIdx + 1} qty`}
                                      inputMode="decimal"
                                      value={c.qty}
                                      onChange={(ev) => setComponent(i.key, c.key, { qty: ev.target.value })}
                                    />
                                  </div>
                                  <div className="field">
                                    <label className="label" htmlFor={`m-comp-unit-${c.key}`}>
                                      Unit
                                    </label>
                                    <input
                                      id={`m-comp-unit-${c.key}`}
                                      aria-label={`Line ${idx + 1} component ${cIdx + 1} unit`}
                                      value={c.unit}
                                      onChange={(ev) => setComponent(i.key, c.key, { unit: ev.target.value })}
                                    />
                                  </div>
                                  <div className="field">
                                    <label className="label" htmlFor={`m-comp-sup-${c.key}`}>
                                      Supplier
                                    </label>
                                    <SearchPicker
                                      id={`m-comp-sup-${c.key}`}
                                      ariaLabel={`Line ${idx + 1} component ${cIdx + 1} supplier`}
                                      value={c.supplierId ?? ""}
                                      options={(supplierList ?? []).map((s) => ({ id: s.id, label: s.name }))}
                                      placeholder="Pick a supplier…"
                                      emptyOptionLabel="—"
                                      onPick={(id) => onComponentSupplierPick(i, c, id || null)}
                                      addLabel="Add supplier"
                                      onAdd={() => openAddSupplier(i.key, c.key)}
                                    />
                                  </div>
                                  <div className="field">
                                    <label className="label" htmlFor={`m-comp-cost-${c.key}`}>
                                      Unit cost
                                    </label>
                                    <input
                                      id={`m-comp-cost-${c.key}`}
                                      aria-label={`Line ${idx + 1} component ${cIdx + 1} unit cost`}
                                      inputMode="decimal"
                                      value={c.unitCost}
                                      onChange={(ev) => setComponent(i.key, c.key, { unitCost: formatMoneyInput(ev.target.value) })}
                                    />
                                    {costHints[`${i.key}:${c.key}`] ? <div className="hint">{costHints[`${i.key}:${c.key}`]}</div> : null}
                                  </div>
                                  <select
                                    className="quote-ln-move"
                                    aria-label={`Move component ${cIdx + 1} of line ${idx + 1} to another lot or out of the lot`}
                                    value=""
                                    onChange={(ev) => onMoveComponent(i, c, ev.target.value)}
                                  >
                                    <option value="">Move to…</option>
                                    {lotTargets(items, i.key).map((t) => (
                                      <option key={t.key} value={t.key}>
                                        Lot {t.n}
                                      </option>
                                    ))}
                                    <option value="__out__">Out of lot</option>
                                  </select>
                                  <button
                                    type="button"
                                    className="btn-link danger"
                                    aria-label={`Remove component ${cIdx + 1} from line ${idx + 1}`}
                                    onClick={() => removeComponent(i.key, c.key)}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                              <div className="quote-ln-comp-foot">
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => addComponent(i)}>
                                  Add component
                                </button>
                                <span className="small muted">
                                  Lot cost {formatPeso(a.supplierTotal)} · Margin {formatPeso(a.margin)}
                                </span>
                              </div>
                            </div>
                          ) : null}
                          {withCosts && !i.isLot ? (
                            <>
                              <div className="field">
                                <label className="label" htmlFor={`m-sup-${i.key}`}>
                                  Supplier (internal)
                                </label>
                                <SearchPicker
                                  id={`m-sup-${i.key}`}
                                  ariaLabel={`Line ${idx + 1} supplier`}
                                  value={i.supplierId ?? ""}
                                  options={(supplierList ?? []).map((s) => ({ id: s.id, label: s.name }))}
                                  placeholder="Pick a supplier…"
                                  emptyOptionLabel="—"
                                  onPick={(id) => onSupplierPick(i, id || null)}
                                  addLabel="Add supplier"
                                  onAdd={() => openAddSupplier(i.key, null)}
                                />
                              </div>
                              <div className="field">
                                <label className="label" htmlFor={`m-cost-${i.key}`}>
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
                                {costHints[i.key] ? <div className="hint">{costHints[i.key]}</div> : null}
                              </div>
                              <div className="field">
                                <span className="label">Margin</span>
                                <span className={`quote-ln-margin${below ? " neg" : ""}`}>{marginText}</span>
                              </div>
                            </>
                          ) : null}
                        </div>
                      ) : null}
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

          {tab === "withholding" && (
            <div role="tabpanel">
              {withholdingPickBoxesHidden(customer?.withholdingType) ? (
                <p className="faint">This customer does not withhold — there is nothing to pick here.</p>
              ) : (
                <WithholdingPickField
                  rates={visibleRates(rates)}
                  value={pick}
                  onChange={changeQuotePick}
                  error={e.withholdingCodes ?? e.withholding}
                  clearToNotSet
                  showLabel={false}
                />
              )}
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
              {showDeliveryWarranty ? (
                <>
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
                </>
              ) : (
                <div className="quote-f field full">
                  <span className="label">Delivery &amp; warranty</span>
                  <div className="faint">No delivery or warranty text for this quote.</div>
                  <div>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTermsNotesOpen(true)}>
                      Add delivery / warranty
                    </button>
                  </div>
                </div>
              )}
              <div className="quote-f field">
                <span className="label">Validity</span>
                <div>{derivedDays != null && derivedDays >= 0 ? `${derivedDays} ${derivedDays === 1 ? "day" : "days"}` : "—"}</div>
              </div>
              <div className={`quote-f field${e.leadTimeDays ? " has-error" : ""}`}>
                <label htmlFor="leadTimeDays">Lead time (business days)</label>
                <input
                  id="leadTimeDays"
                  type="number"
                  min={1}
                  max={365}
                  inputMode="numeric"
                  value={leadTimeDays}
                  onChange={(ev) => setLeadTimeDays(ev.target.value)}
                  placeholder="No estimate"
                />
                <div className="hint">Prints in the terms as the estimated lead time · Leave blank for no figure</div>
                {e.leadTimeDays && <div className="error">{e.leadTimeDays}</div>}
              </div>
              <div className="quote-f field full">
                <span className="label">Terms &amp; conditions</span>
                {printDefaults.quoteTerms?.trim() ? (
                  <>
                    <textarea readOnly rows={4} value={printDefaults.quoteTerms} aria-readonly />
                    <div className="hint">From Settings · Read-only in Phase 1</div>
                  </>
                ) : (
                  <div className="faint">No standard terms set in Settings.</div>
                )}
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
              <div className={`quote-f field${e.preparedById ? " has-error" : ""}`}>
                <label htmlFor="preparedById">Prepared by</label>
                <select id="preparedById" value={preparedByIdState} onChange={(ev) => setPreparedByIdState(ev.target.value)}>
                  {staffUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                      {u.position ? ` — ${u.position}` : ""}
                    </option>
                  ))}
                </select>
                {preparer?.hasSignature ? (
                  <div style={{ marginTop: 4 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/files/user-signature/${preparer.id}`} alt="Preparer signature" style={{ maxHeight: 56, border: "1px solid var(--border)", background: "#fff" }} />
                  </div>
                ) : null}
                {preparer?.position ? <div className="small muted">{preparer.position}</div> : null}
                {e.preparedById && <div className="error">{e.preparedById}</div>}
              </div>
              {approvedByName ? (
                <div className="quote-f field">
                  <span className="label">Approved by</span>
                  <div className="strong">{approvedByName}</div>
                  {approvedAt ? <div className="small muted">{approvedAt}</div> : null}
                </div>
              ) : null}
              <div className="quote-f field">
                <span className="label">Conforme (customer)</span>
                <div className="quote-signoff-lines">
                  <div className="quote-signoff-line" />
                  <div className="small faint">Name and signature</div>
                </div>
              </div>
              <div className="hint">Pick who prepared this quote — the name prints under Prepared by. Conforme stays a blank line for a wet signature or the customer&apos;s signed PO; a signed conforme can be uploaded from the quote page. System-generated and approved. No signature required.</div>
              <p className="right small muted">{totalsSummary}</p>
            </div>
          )}
        </div>

      </form>

      <AddCustomerDialog open={addCustomerOpen} onClose={() => setAddCustomerOpen(false)} onSaved={onCustomerCreated} rates={rates} terms={termsOptions} />
      {addContactOpen && customer && (
        <AddContactDialog
          open={addContactOpen}
          onClose={() => setAddContactOpen(false)}
          owner={{ kind: "customer", id: customer.id }}
          ownerName={customer.name}
          roles={contactRoles}
          onSaved={onContactAdded}
        />
      )}
      {addSupplierOpen && (
        <AddSupplierDialog open={addSupplierOpen} onClose={() => setAddSupplierOpen(false)} termsOptions={termsOptions} onSaved={onSupplierCreated} />
      )}
      {addAddressOpen && customer && (
        <AddAddressDialog
          customerName={customer.name}
          onClose={() => setAddAddressOpen(false)}
          onSaved={onAddressAdded}
          action={(input) => addAddressAction(customer.id, input)}
        />
      )}

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

      {drawerFor != null &&
        (() => {
          const line = items.find((x) => x.key === drawerFor);
          if (!line) return null;
          const nc = line.newCatalog ?? { brand: "", model: "", category: "", sku: "", details: "" };
          const setNc = (patch: Partial<typeof nc>) => setItem(line.key, { newCatalog: { ...nc, ...patch } });
          return (
            <Modal title={line.itemId ? "Product details" : "Add to Products"} labelId="product-details-title" variant="drawer-right" onClose={() => setDrawerFor(null)}>
              {line.itemId ? (
                <>
                  {drawerBusy ? (
                    <p className="small muted">Loading the catalog item…</p>
                  ) : drawerItem ? (
                    <dl className="quote-product-dl">
                      <dt>Name</dt>
                      <dd>{drawerItem.name}</dd>
                      {drawerItem.brand ? (
                        <>
                          <dt>Brand</dt>
                          <dd>{drawerItem.brand}</dd>
                        </>
                      ) : null}
                      {drawerItem.model ? (
                        <>
                          <dt>Model</dt>
                          <dd>{drawerItem.model}</dd>
                        </>
                      ) : null}
                      {drawerItem.category ? (
                        <>
                          <dt>Category</dt>
                          <dd>{drawerItem.category}</dd>
                        </>
                      ) : null}
                      {drawerItem.sku ? (
                        <>
                          <dt>SKU / part no.</dt>
                          <dd>{drawerItem.sku}</dd>
                        </>
                      ) : null}
                      <dt>Unit</dt>
                      <dd>{drawerItem.unit}</dd>
                      <dt>Kind</dt>
                      <dd>{drawerItem.kind === "GOODS" ? "Goods" : "Services"}</dd>
                      {drawerItem.details ? (
                        <>
                          <dt>Details</dt>
                          <dd>{drawerItem.details}</dd>
                        </>
                      ) : null}
                      {drawerItem.defaultUnitPrice != null ? (
                        <>
                          <dt>Default unit price</dt>
                          <dd>₱{Number(drawerItem.defaultUnitPrice).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</dd>
                        </>
                      ) : null}
                    </dl>
                  ) : (
                    <p className="small muted">Couldn&apos;t load the catalog item — the line stays linked as “{line.itemName ?? "Linked product"}”.</p>
                  )}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <a className="btn btn-secondary" href={`/items/${line.itemId}`} target="_blank" rel="noreferrer">
                      Open in catalog
                    </a>
                    <button type="button" className="btn btn-secondary" onClick={() => setItem(line.key, { itemId: null, itemName: null })}>
                      Unlink
                    </button>
                    <button type="button" className="btn" onClick={() => setDrawerFor(null)}>
                      Done
                    </button>
                  </div>
                  <p className="hint">Catalog fields are edited on the item&apos;s catalog page, so there is one place to change them.</p>
                </>
              ) : (
                <>
                  <p className="small muted">“{line.description || "This line"}” isn&apos;t linked to the catalog yet. Saving this quote adds it as a new catalog item — the fields below are optional extras, blank is fine.</p>
                  <div className="field">
                    <label className="label" htmlFor="nc-brand">Brand</label>
                    <input id="nc-brand" type="text" value={nc.brand} onChange={(ev) => setNc({ brand: ev.target.value })} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="nc-model">Model</label>
                    <input id="nc-model" type="text" value={nc.model} onChange={(ev) => setNc({ model: ev.target.value })} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="nc-category">Category</label>
                    <input id="nc-category" type="text" value={nc.category} onChange={(ev) => setNc({ category: ev.target.value })} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="nc-sku">SKU / part no.</label>
                    <input id="nc-sku" type="text" value={nc.sku} onChange={(ev) => setNc({ sku: ev.target.value })} />
                  </div>
                  <div className="field full">
                    <label className="label" htmlFor="nc-details">Details</label>
                    <textarea id="nc-details" rows={2} value={nc.details} onChange={(ev) => setNc({ details: ev.target.value })} placeholder="e.g. 12 months" />
                  </div>
                  <button type="button" className="btn" onClick={() => setDrawerFor(null)}>
                    Done
                  </button>
                </>
              )}
            </Modal>
          );
        })()}
    </>
  );
}

function hasNonEmptyPicks(picks: WithholdingSnapshot[] | null): boolean {
  return Array.isArray(picks) && picks.length > 0;
}

type NewAddressFields = { label: string; street: string; barangay: string; cityMunicipality: string; province: string; zip: string };

/**
 * "+ Add new address" in the delivery picker: saves a DELIVERY address to
 * the customer (same fields + validation as the customer profile) and hands
 * it back so the editor can pick it at once.
 */
function AddAddressDialog({
  customerName,
  onClose,
  onSaved,
  action,
}: {
  customerName: string;
  onClose: () => void;
  onSaved: (a: EditorAddressOption) => void;
  action: (input: NewAddressFields) => Promise<FormState & { address?: EditorAddressOption }>;
}) {
  const [fields, setFields] = useState<NewAddressFields>({ label: "", street: "", barangay: "", cityMunicipality: "", province: "", zip: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof NewAddressFields) => (ev: { target: { value: string } }) => setFields((f) => ({ ...f, [k]: ev.target.value }));

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await action(fields);
      if (res.address) {
        onSaved(res.address);
        return;
      }
      setErrors(res.fieldErrors ?? {});
      setMessage(res.message ?? "Could not add the address.");
    } finally {
      setBusy(false);
    }
  }

  const field = (k: keyof NewAddressFields, label: string, required: boolean, maxLength?: number) => (
    <div className={`field${errors[k] ? " has-error" : ""}`}>
      <label htmlFor={`qa-${k}`}>
        {label}
        {required && <span className="req"> *</span>}
      </label>
      <input id={`qa-${k}`} type="text" value={fields[k]} maxLength={maxLength} onChange={set(k)} />
      {errors[k] && <div className="error">{errors[k]}</div>}
    </div>
  );

  return (
    <Modal title={`Add delivery address — ${customerName}`} onClose={onClose} labelId="qa-title">
      <p className="small muted">Saved to the customer as a Delivery address and picked on this quote.</p>
      {message && (
        <div className="alert error" role="alert">
          {message}
        </div>
      )}
      {field("label", "Label (e.g. Warehouse)", false, 100)}
      {field("street", "Unit / building / street", true, 500)}
      {field("barangay", "Barangay", true, 120)}
      {field("cityMunicipality", "City / municipality", true, 120)}
      {field("province", "Province", true, 120)}
      {field("zip", "ZIP code", true, 4)}
      <div className="buttons">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn" onClick={submit} disabled={busy}>
          {busy ? "Adding…" : "Add address"}
        </button>
      </div>
    </Modal>
  );
}
