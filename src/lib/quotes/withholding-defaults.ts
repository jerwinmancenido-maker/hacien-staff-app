// Customer-type → line withholding defaults. Pure and dependency-free so the
// browser editor, the server and unit tests share one mapping.
//
// Snapshot rate + ATC onto each quote/SO line at creation. Later changes to the
// customer's type never alter existing lines; staff must click
// "Re-apply customer's withholding" on a draft to refresh non-override lines
// (lines with withholdingOverride=true are skipped).
//
// Document totals = sum of per-line (line total × line rate), rounded per line
// (src/lib/quotes/calc.ts). The document-level withholding JSON is a read-only
// summary of those line rates — not a second rate source.

import type { ItemKind, WithholdingLineKind, WithholdingSnapshot } from "./calc";
import { BUSINESS_IS_VAT_REGISTERED } from "../tax/constants";

/** Staff-facing strings (no extra customer-facing tax copy). */
export const MISSING_WITHHOLDING_TYPE_WARNING = "Set this customer's withholding type";
export const OVERRIDE_NOTE = "Changed from this customer's usual";
export const REAPPLY_WITHHOLDING_LABEL = "Re-apply customer's withholding";

/**
 * ATC labels in ONE config map.
 *
 * Government ATC codes below are UNVERIFIED — an accountant must review them
 * against the latest BIR withholding tables before production use.
 */
export const ATC_LABELS = {
  WI158: "EWT — goods (TWA) 1%",
  WI160: "EWT — services (TWA) 2%",
  // UNVERIFIED — confirm with accountant / BIR before relying on these codes:
  WG010: "Government percentage tax 3% (UNVERIFIED — code to confirm)",
  WV050: "Government VAT withholding 5% (UNVERIFIED — code to confirm)",
} as const;

/** Government ATCs stay UNVERIFIED; UI may hide the code and show this instead. */
export const GOV_ATC_CODE_TO_CONFIRM = "code to confirm";

export function isUnverifiedGovAtc(atc: string | null | undefined): boolean {
  return atc === "WG010" || atc === "WV050";
}

export type AtcCode = keyof typeof ATC_LABELS;

/** Stable rate codes already used in Settings → Withholding / seeds. */
export const WITHHOLDING_DEFAULT_CODES = {
  GOODS_1: "GOODS_1",
  SERVICES_2: "SERVICES_2",
  GOV_PT_3: "GOV_PT_3",
  GOV_VAT_5: "GOV_VAT_5",
} as const;

type DefaultRow = {
  code: string;
  label: string;
  lineKind: WithholdingLineKind;
  rate: string;
  atcCode: AtcCode;
};

/** Existing rate values (do not change). ATC codes come from ATC_LABELS. */
export const WITHHOLDING_DEFAULT_ROWS: Record<keyof typeof WITHHOLDING_DEFAULT_CODES, DefaultRow> = {
  GOODS_1: {
    code: WITHHOLDING_DEFAULT_CODES.GOODS_1,
    label: "Goods 1%",
    lineKind: "GOODS",
    rate: "0.0100",
    atcCode: "WI158",
  },
  SERVICES_2: {
    code: WITHHOLDING_DEFAULT_CODES.SERVICES_2,
    label: "Services 2%",
    lineKind: "SERVICES",
    rate: "0.0200",
    atcCode: "WI160",
  },
  GOV_PT_3: {
    code: WITHHOLDING_DEFAULT_CODES.GOV_PT_3,
    label: "Government percentage tax 3% (code to confirm)",
    lineKind: "GOV_PT",
    rate: "0.0300",
    atcCode: "WG010",
  },
  GOV_VAT_5: {
    code: WITHHOLDING_DEFAULT_CODES.GOV_VAT_5,
    label: "Government VAT 5% (code to confirm)",
    lineKind: "GOV_VAT",
    rate: "0.0500",
    atcCode: "WV050",
  },
};

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

function rowToDefault(row: DefaultRow): LineWithholdingDefault {
  return { rate: row.rate, atc: row.atcCode, code: row.code, label: row.label, lineKind: row.lineKind };
}

export function isKnownWithholdingType(type: string | null | undefined): type is KnownWithholdingType {
  return type === "GOVERNMENT" || type === "TOP_WITHHOLDING_AGENT" || type === "NONE";
}

/** Unknown or missing type → show the staff warning; never guess a rate. */
export function needsWithholdingTypeWarning(type: string | null | undefined): boolean {
  return !isKnownWithholdingType(type);
}

/**
 * Pure mapping (customer type, line kind) → { rate, ATC }.
 *
 * - Top Withholding Agent: goods 1% (WI158), services 2% (WI160).
 * - Government: existing gov rates already in the code (PT 3%, VAT 5%).
 * - None / unknown / missing: 0 (caller shows the warning for unknown).
 */
export function defaultWithholdingFor(
  customerType: string | null | undefined,
  lineKind: DefaultWithholdingLineKind,
): LineWithholdingDefault {
  if (!isKnownWithholdingType(customerType) || customerType === "NONE") return ZERO;

  if (customerType === "TOP_WITHHOLDING_AGENT") {
    if (lineKind === "GOODS") return rowToDefault(WITHHOLDING_DEFAULT_ROWS.GOODS_1);
    if (lineKind === "SERVICES") return rowToDefault(WITHHOLDING_DEFAULT_ROWS.SERVICES_2);
    return ZERO;
  }

  // GOVERNMENT — existing gov rates.
  if (lineKind === "GOV_VAT") return rowToDefault(WITHHOLDING_DEFAULT_ROWS.GOV_VAT_5);
  // Gov goods / services → government percentage tax (applies to whole total in calc).
  return rowToDefault(WITHHOLDING_DEFAULT_ROWS.GOV_PT_3);
}

export function defaultForItemKind(
  customerType: string | null | undefined,
  kind: ItemKind,
): LineWithholdingDefault {
  return defaultWithholdingFor(customerType, kind);
}

/** Whether the business may offer the Gov VAT 5% option (existing non-VAT setting). */
export function allowGovVatOption(businessIsVatRegistered: boolean = BUSINESS_IS_VAT_REGISTERED): boolean {
  return businessIsVatRegistered;
}

/**
 * Document-level withholding snapshot from the customer type and the item kinds
 * on the quote. Does not read Customer.defaultWithholding.
 */
export function documentWithholdingFromCustomer(
  customerType: string | null | undefined,
  itemKinds: readonly ItemKind[],
  opts: { includeGovVat?: boolean; businessIsVatRegistered?: boolean } = {},
): WithholdingSnapshot[] {
  if (!isKnownWithholdingType(customerType) || customerType === "NONE") return [];

  if (customerType === "TOP_WITHHOLDING_AGENT") {
    const out: WithholdingSnapshot[] = [];
    const hasGoods = itemKinds.length === 0 || itemKinds.some((k) => k === "GOODS");
    const hasServices = itemKinds.length === 0 || itemKinds.some((k) => k === "SERVICES");
    if (hasGoods) {
      const d = WITHHOLDING_DEFAULT_ROWS.GOODS_1;
      out.push({ code: d.code, label: d.label, lineKind: d.lineKind, rate: d.rate, atcCode: d.atcCode });
    }
    if (hasServices) {
      const d = WITHHOLDING_DEFAULT_ROWS.SERVICES_2;
      out.push({ code: d.code, label: d.label, lineKind: d.lineKind, rate: d.rate, atcCode: d.atcCode });
    }
    return out;
  }

  // GOVERNMENT
  const out: WithholdingSnapshot[] = [];
  const pt = WITHHOLDING_DEFAULT_ROWS.GOV_PT_3;
  out.push({ code: pt.code, label: pt.label, lineKind: pt.lineKind, rate: pt.rate, atcCode: pt.atcCode });
  const includeVat = opts.includeGovVat === true && allowGovVatOption(opts.businessIsVatRegistered);
  if (includeVat) {
    const v = WITHHOLDING_DEFAULT_ROWS.GOV_VAT_5;
    out.push({ code: v.code, label: v.label, lineKind: v.lineKind, rate: v.rate, atcCode: v.atcCode });
  }
  return out;
}

/**
 * True when the line's stored rate/ATC differ from the customer's usual for its kind.
 * A null/blank rate means "not snapshotted yet" — never treat that as an override.
 */
export function lineDiffersFromUsual(
  customerType: string | null | undefined,
  kind: ItemKind,
  stored: { rate: string | null | undefined; atc: string | null | undefined },
): boolean {
  if (stored.rate == null || String(stored.rate).trim() === "") return false;
  const usual = defaultForItemKind(customerType, kind);
  const rate = Number(stored.rate).toFixed(4);
  const atc = stored.atc ?? null;
  return rate !== usual.rate || atc !== usual.atc;
}

/** Snapshot fields to persist on a new / re-applied line. */
export function lineWithholdingSnapshot(
  customerType: string | null | undefined,
  kind: ItemKind,
): { withholdingRate: string; withholdingAtc: string | null; withholdingOverride: boolean } {
  const d = defaultForItemKind(customerType, kind);
  return {
    withholdingRate: d.rate,
    withholdingAtc: d.atc,
    withholdingOverride: false,
  };
}
