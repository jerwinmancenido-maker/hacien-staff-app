// Manual withholding picks (customer → quote), not hard-coded by customer type.
//
// Customer.defaultWithholding (JSON):
//   null  = not set
//   []    = explicit none
//   ["GOV_GOODS_1","GOV_PT_3",…] = picked rate codes from Settings → Withholding
//
// New quotes copy the customer's pick. Staff can change the quote-level pick and
// per-line overrides. Changing a customer's saved pick never rewrites existing
// quotes, SOs or billings — staff must re-apply on a draft.
//
// Rates apply by each rate's "Applies to" (lineKind):
//   GOODS → goods lines, SERVICES → services lines, GOV_PT / GOV_VAT → whole total
//   (every line). Combined picks sum onto the line rate (e.g. Gov goods 1% + Gov
//   percentage tax 3% → goods lines at 4%).
//
// Document totals = sum of per-line (line total × line rate), rounded per line
// (src/lib/quotes/calc.ts). Customer type (GOVERNMENT / TWA / NONE) is a label
// only — it never chooses a rate.
//
// ATC codes below are Confirmed from BIR Form 2307 Appendix ATC list
// (https://bangsamoro.gov.ph/wp-content/uploads/2024/12/Appendix-26-BIR-Form-2307.pdf).
// Rate percentages remain Unverified until an accountant confirms.

import type { ItemKind, WithholdingLineKind, WithholdingSnapshot } from "./calc";
import { BUSINESS_IS_VAT_REGISTERED } from "../tax/constants.ts";

/** Staff-facing notice when the quote has no withholding pick yet. */
export const WITHHOLDING_NOT_SET_NOTICE =
  "Withholding not set for this customer. Pick the rates the agency will withhold.";

/** Confirm title when submitting with no pick. */
export const WITHHOLDING_NONE_CONFIRM_TITLE = "No withholding on this quote?";

/** Confirm choices (exact labels). */
export const WITHHOLDING_NONE_CONFIRM_YES = "Yes, none";
export const WITHHOLDING_NONE_CONFIRM_PICK = "Pick rates";

/** Grey hint under Customer when nothing is picked. */
export const WITHHOLDING_HINT_NOT_SET = "Withholding: not set";
export const WITHHOLDING_HINT_NONE = "Withholding: none";

/** Internal-only panel label (never printed). */
export const WITHHOLDING_INTERNAL_PANEL_LABEL = "Internal — withholding estimate (not on the printed quote)";

/** Internal cost box — margin is contract − supplier (WH is a tax credit, not a cost). */
export const INTERNAL_MARGIN_LABEL = "Margin";
/** Internal cost box — cash after customer withholding. */
export const INTERNAL_CASH_AFTER_WH_LABEL = "Cash we receive after withholding";

/** Staff-facing strings (no extra customer-facing tax copy). */
export const OVERRIDE_NOTE = "Changed from this customer's usual";
export const REAPPLY_WITHHOLDING_LABEL = "Re-apply customer's withholding";

/** Pick-field actions (quote details + customer form). */
export const WITHHOLDING_PICK_NONE_LABEL = "No withholding";
export const WITHHOLDING_PICK_RESET_LABEL = "Reset";
/** Collapsed quote-details row — expand checkboxes. */
export const WITHHOLDING_PICK_CHANGE_LABEL = "Change";

/**
 * Resolve the pick to persist from the customer type dropdown + checkbox state.
 * "No" (NONE) always saves [] — the boxes are hidden.
 */
export function resolveCustomerSavedPick(
  withholdingType: string | null | undefined,
  pick: string[] | null | undefined,
): string[] | null {
  if (withholdingType === "NONE") return [];
  if (pick === undefined) return null;
  return pick;
}

/** @deprecated Prefer WITHHOLDING_NOT_SET_NOTICE — type no longer drives rates. */
export const MISSING_WITHHOLDING_TYPE_WARNING = WITHHOLDING_NOT_SET_NOTICE;

/**
 * ATC labels (Confirmed codes from BIR 2307 ATC appendix).
 * Rate % values are Unverified until accountant review.
 */
export const ATC_LABELS = {
  WI640: "EWT — government goods 1%",
  WI157: "EWT — government services 2%",
  WB080: "Government percentage tax 3%",
  WI158: "EWT — private top agent goods 1%",
  WI160: "EWT — private top agent services 2%",
  "WV010/WV020": "VAT withheld 5%",
} as const;

/**
 * @deprecated Pass 3: ATC codes are Confirmed from the 2307 list — never hide them.
 * Kept empty so old call sites compile; never show this to staff.
 */
export const GOV_ATC_CODE_TO_CONFIRM = "";

/** @deprecated Always false — Confirmed ATC codes are shown as-is. */
export function isUnverifiedGovAtc(atc: string | null | undefined): boolean {
  void atc;
  return false;
}

export type AtcCode = keyof typeof ATC_LABELS;

/** Stable Settings → Withholding codes (Pass 3 catalog). */
export const WITHHOLDING_DEFAULT_CODES = {
  GOV_GOODS_1: "GOV_GOODS_1",
  GOV_SERVICES_2: "GOV_SERVICES_2",
  GOV_PT_3: "GOV_PT_3",
  GOODS_1: "GOODS_1",
  SERVICES_2: "SERVICES_2",
  GOV_VAT_5: "GOV_VAT_5",
} as const;

type DefaultRow = {
  code: string;
  label: string;
  lineKind: WithholdingLineKind;
  rate: string;
  atcCode: AtcCode;
  /** When false, Settings seeds the row inactive (staff may turn on later). */
  active: boolean;
  sortOrder: number;
};

/**
 * Default Settings → Withholding catalog (exact Pass 3 order).
 * Labels include the Confirmed ATC in parentheses. Rate % Unverified.
 */
export const WITHHOLDING_DEFAULT_ROWS: Record<keyof typeof WITHHOLDING_DEFAULT_CODES, DefaultRow> = {
  GOV_GOODS_1: {
    code: WITHHOLDING_DEFAULT_CODES.GOV_GOODS_1,
    label: "Government goods 1% (WI640)",
    lineKind: "GOODS",
    rate: "0.0100",
    atcCode: "WI640",
    active: true,
    sortOrder: 1,
  },
  GOV_SERVICES_2: {
    code: WITHHOLDING_DEFAULT_CODES.GOV_SERVICES_2,
    label: "Government services 2% (WI157)",
    lineKind: "SERVICES",
    rate: "0.0200",
    atcCode: "WI157",
    active: true,
    sortOrder: 2,
  },
  GOV_PT_3: {
    code: WITHHOLDING_DEFAULT_CODES.GOV_PT_3,
    label: "Government percentage tax 3% (WB080)",
    lineKind: "GOV_PT",
    rate: "0.0300",
    atcCode: "WB080",
    active: true,
    sortOrder: 3,
  },
  GOODS_1: {
    code: WITHHOLDING_DEFAULT_CODES.GOODS_1,
    label: "Private top agent goods 1% (WI158)",
    lineKind: "GOODS",
    rate: "0.0100",
    atcCode: "WI158",
    active: true,
    sortOrder: 4,
  },
  SERVICES_2: {
    code: WITHHOLDING_DEFAULT_CODES.SERVICES_2,
    label: "Private top agent services 2% (WI160)",
    lineKind: "SERVICES",
    rate: "0.0200",
    atcCode: "WI160",
    active: true,
    sortOrder: 5,
  },
  GOV_VAT_5: {
    code: WITHHOLDING_DEFAULT_CODES.GOV_VAT_5,
    label: "VAT withheld 5% (WV010/WV020)",
    lineKind: "GOV_VAT",
    rate: "0.0500",
    atcCode: "WV010/WV020",
    active: false,
    sortOrder: 6,
  },
};

/** Ordered list for seed / migration (sortOrder ascending). */
export const WITHHOLDING_DEFAULT_CATALOG: readonly DefaultRow[] = [
  WITHHOLDING_DEFAULT_ROWS.GOV_GOODS_1,
  WITHHOLDING_DEFAULT_ROWS.GOV_SERVICES_2,
  WITHHOLDING_DEFAULT_ROWS.GOV_PT_3,
  WITHHOLDING_DEFAULT_ROWS.GOODS_1,
  WITHHOLDING_DEFAULT_ROWS.SERVICES_2,
  WITHHOLDING_DEFAULT_ROWS.GOV_VAT_5,
];

/** Customer type remains a label only (does not choose rates). */
export const KNOWN_WITHHOLDING_TYPES = ["GOVERNMENT", "TOP_WITHHOLDING_AGENT", "NONE"] as const;
export type KnownWithholdingType = (typeof KNOWN_WITHHOLDING_TYPES)[number];

/** Line kinds the pure mapper accepts (item kinds + Gov VAT). */
export type DefaultWithholdingLineKind = "GOODS" | "SERVICES" | "GOV_VAT";

export type LineWithholdingDefault = {
  /** Fraction string, e.g. "0.0100". Zero when none / unknown. */
  rate: string;
  atc: string | null;
  code: string | null;
  label: string | null;
  lineKind: WithholdingLineKind | null;
};

const ZERO: LineWithholdingDefault = { rate: "0.0000", atc: null, code: null, label: null, lineKind: null };

export function isKnownWithholdingType(type: string | null | undefined): type is KnownWithholdingType {
  return type === "GOVERNMENT" || type === "TOP_WITHHOLDING_AGENT" || type === "NONE";
}

/**
 * @deprecated Type no longer drives rates. Kept so old call sites compile during
 * the cutover; always returns false.
 */
export function needsWithholdingTypeWarning(type: string | null | undefined): boolean {
  void type;
  return false;
}

/** True when the pick is still null (staff has not chosen rates or none). */
export function isWithholdingNotSet(pick: readonly string[] | null | undefined): boolean {
  return pick == null;
}

/** True when staff explicitly chose none ([]). */
export function isWithholdingNone(pick: readonly string[] | null | undefined): boolean {
  return Array.isArray(pick) && pick.length === 0;
}

/** Parse Customer.defaultWithholding / Quote.withholdingPick JSON → null | string[]. */
export function parseWithholdingPick(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  const codes = raw.filter((v): v is string => typeof v === "string" && v.trim() !== "");
  return codes;
}

function rateAppliesToKind(lineKind: WithholdingLineKind, kind: ItemKind): boolean {
  if (lineKind === "GOODS") return kind === "GOODS";
  if (lineKind === "SERVICES") return kind === "SERVICES";
  // GOV_PT / GOV_VAT apply to the whole total → every line.
  return true;
}

/**
 * Sum of picked rates that apply to this item kind.
 * Single applicable rate → keep its ATC/code/label.
 * Several → combined rate; ATC from the single line-kind-specific rate when present.
 */
export function lineWithholdingFromPicks(
  picks: readonly WithholdingSnapshot[],
  kind: ItemKind,
): LineWithholdingDefault {
  const applicable = picks.filter((p) => rateAppliesToKind(p.lineKind, kind));
  if (applicable.length === 0) return ZERO;

  let sum = 0;
  for (const p of applicable) sum += Number(p.rate);
  const rate = sum.toFixed(4);

  if (applicable.length === 1) {
    const only = applicable[0]!;
    return {
      rate,
      atc: only.atcCode,
      code: only.code,
      label: only.label,
      lineKind: only.lineKind,
    };
  }

  // Combined picks: keep ATC from the single line-kind-specific rate when present.
  const kindSpecific = applicable.filter((p) => p.lineKind === kind);
  if (kindSpecific.length === 1) {
    return {
      rate,
      atc: kindSpecific[0]!.atcCode,
      code: null,
      label: null,
      lineKind: null,
    };
  }

  return { rate, atc: null, code: null, label: null, lineKind: null };
}

/** Snapshot fields to persist on a new / re-applied line from the pick list. */
export function lineWithholdingSnapshotFromPicks(
  picks: readonly WithholdingSnapshot[],
  kind: ItemKind,
): { withholdingRate: string; withholdingAtc: string | null; withholdingOverride: boolean } {
  const d = lineWithholdingFromPicks(picks, kind);
  return {
    withholdingRate: d.rate,
    withholdingAtc: d.atc,
    withholdingOverride: false,
  };
}

/**
 * @deprecated Does not choose rates from customer type. Always returns zero.
 * Kept so a unit test can prove no code path auto-picks from type.
 */
export function defaultWithholdingFor(
  customerType: string | null | undefined,
  lineKind: DefaultWithholdingLineKind,
): LineWithholdingDefault {
  void customerType;
  void lineKind;
  return ZERO;
}

/** @deprecated Prefer lineWithholdingFromPicks — type never chooses a rate. */
export function defaultForItemKind(
  customerType: string | null | undefined,
  kind: ItemKind,
): LineWithholdingDefault {
  void customerType;
  void kind;
  return ZERO;
}

/** Whether the business may offer the Gov VAT 5% option (existing non-VAT setting). */
export function allowGovVatOption(businessIsVatRegistered: boolean = BUSINESS_IS_VAT_REGISTERED): boolean {
  return businessIsVatRegistered;
}

/**
 * @deprecated Prefer buildWithholdingSnapshot(codes, rates). Type never chooses rates.
 */
export function documentWithholdingFromCustomer(
  customerType: string | null | undefined,
  itemKinds: readonly ItemKind[],
  opts: { includeGovVat?: boolean; businessIsVatRegistered?: boolean } = {},
): WithholdingSnapshot[] {
  void customerType;
  void itemKinds;
  void opts;
  return [];
}

/**
 * True when the line's stored rate/ATC differ from the pick-derived usual for its kind.
 * A null/blank rate means "not snapshotted yet" — never treat that as an override.
 */
export function lineDiffersFromUsualPicks(
  picks: readonly WithholdingSnapshot[],
  kind: ItemKind,
  stored: { rate: string | null | undefined; atc: string | null | undefined },
): boolean {
  if (stored.rate == null || String(stored.rate).trim() === "") return false;
  const usual = lineWithholdingFromPicks(picks, kind);
  const rate = Number(stored.rate).toFixed(4);
  if (rate !== usual.rate) return true;
  const atc = stored.atc != null && String(stored.atc).trim() !== "" ? String(stored.atc).trim() : null;
  // Blank ATC with a matching rate is not an override (legacy combined rows omitted ATC).
  if (atc == null) return false;
  return atc !== (usual.atc ?? null);
}

/**
 * @deprecated Prefer lineDiffersFromUsualPicks.
 * (customer type never chooses a rate).
 */
export function lineDiffersFromUsual(
  customerType: string | null | undefined,
  kind: ItemKind,
  stored: { rate: string | null | undefined; atc: string | null | undefined },
): boolean {
  void customerType;
  return lineDiffersFromUsualPicks([], kind, stored);
}

/** @deprecated Prefer lineWithholdingSnapshotFromPicks. */
export function lineWithholdingSnapshot(
  customerType: string | null | undefined,
  kind: ItemKind,
): { withholdingRate: string; withholdingAtc: string | null; withholdingOverride: boolean } {
  void customerType;
  void kind;
  return { withholdingRate: "0.0000", withholdingAtc: null, withholdingOverride: false };
}

/** Format one rate for staff hints / chips (ATC once; labels already include it). */
export function formatWithholdingPickPart(p: WithholdingSnapshot): string {
  if (p.atcCode && p.label.includes(p.atcCode)) return p.label;
  if (p.atcCode) return `${p.label} (${p.atcCode})`;
  return p.label;
}

/** Staff hint under Customer: picked rates, "not set", or "none". Always from the saved pick — never from customer type. */
export function customerWithholdingHint(picks: readonly WithholdingSnapshot[] | null | undefined): string {
  if (picks == null) return WITHHOLDING_HINT_NOT_SET;
  if (picks.length === 0) return WITHHOLDING_HINT_NONE;
  return `Withholding: ${picks.map(formatWithholdingPickPart).join(" + ")}`;
}

/**
 * Short chip / header label for the customer's saved pick.
 * Never returns the type label "No withholding" while rates are picked.
 */
export function customerWithholdingChipLabel(picks: readonly WithholdingSnapshot[] | null | undefined): string {
  if (picks == null) return "Withholding: not set";
  if (picks.length === 0) return "Withholding: none";
  return picks.map(formatWithholdingPickPart).join(" + ");
}

/** Field label on the customer page / add-customer dialog. */
export const WITHHOLDING_PICK_FIELD_LABEL = "Withholding";

/** Hint under the multi-select on the customer form. */
export const WITHHOLDING_PICK_FIELD_HINT =
  "Tick the rates this agency withholds. You can combine rates (for example Government goods 1% + Government percentage tax 3%).";
