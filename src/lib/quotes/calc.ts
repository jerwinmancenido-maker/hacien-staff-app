// Quote / sales order math. Pure and dependency-free (the browser editor, the
// server and prisma/seed.mts all use it), with exact decimal arithmetic on
// scaled BigInts so there are no floating-point surprises.
//
// Money is pesos with 2 decimals; quantities have 2 decimals; withholding rates
// are fractions with 4 decimals (0.0100 = 1%). Rounding is half-up (away from
// zero) to 2 decimals, done per line (qty × price, and line × withholding rate).
//
// HACIEN is non-VAT: the withholding base is the gross line total, never
// divided by 1.12.
//
// Expected withholding = sum over lines of round_half_up(line.total × line.rate).
// Lines with a null/empty rate contribute ₱0 (legacy rows that were never
// snapshotted). Document-level withholding JSON is a read-only summary of the
// line rates — not a second source of truth for the math.

export type ItemKind = "GOODS" | "SERVICES";
export type WithholdingLineKind = "GOODS" | "SERVICES" | "GOV_PT" | "GOV_VAT";

/** One withholding rate as snapshotted on a quote / SO. `rate` is a fraction string, e.g. "0.0100". */
export type WithholdingSnapshot = {
  code: string;
  label: string;
  lineKind: WithholdingLineKind;
  rate: string;
  atcCode: string | null;
};

export type LineInput = {
  kind: ItemKind;
  qty: string;
  unitPrice: string;
  supplierUnitCost: string;
};

export type LineAmounts = {
  /** qty × HACIEN unit price */
  total: string;
  /** supplier unit cost × buyer qty */
  supplierTotal: string;
  /** total − supplier total */
  margin: string;
};

/** Line fields needed to total a document (amounts + optional per-line rate/ATC). */
export type LineForDocTotals = (LineInput | (Pick<LineInput, "kind"> & LineAmounts)) & {
  /** Fraction string; null/undefined/"" → no withholding on this line. */
  withholdingRate?: string | null;
  withholdingAtc?: string | null;
};

export type WithholdingLine = WithholdingSnapshot & { base: string; amount: string };

export type SupplierCostState = "none" | "partial" | "full";

/** Shown instead of a peso and a percent when supplier cost was not entered. */
export const COST_NOT_SET_LABEL = "Cost not set";

export type DocTotals = {
  /** Sum of buyer line totals. */
  contractPrice: string;
  withholding: WithholdingLine[];
  withholdingTotal: string;
  /** Contract price − withholding. */
  netReceived: string;
  /** Sum of supplier totals. */
  supplierCost: string;
  /**
   * Contract − supplier. Withholding is not a cost.
   * A blank supplier cost still stores this as the full contract (netMarginPct 100.00).
   */
  netMargin: string;
  /** Net margin as % of the contract price (2 dp); "0.00" when the contract price is 0. */
  netMarginPct: string;
  /** none = every line's supplier total is 0; partial = some; full = every line. */
  supplierCostState: SupplierCostState;
};

/** Blank or ₱0.00 supplier unit cost. A typed zero uses the same path as a blank. */
export function supplierCostMissing(value: string | null | undefined): boolean {
  const s = String(value ?? "").trim();
  if (s === "") return true;
  if (!DECIMAL.test(s)) return true;
  return toScaled(s, CENTS) === 0n;
}

export function linesMissingSupplierCost(lines: readonly { supplierUnitCost?: string | null }[]): boolean {
  return lines.some((l) => supplierCostMissing(l.supplierUnitCost));
}

export function supplierCostStateFromSupplierTotals(totals: readonly string[]): SupplierCostState {
  if (totals.length === 0) return "none";
  let present = 0;
  for (const t of totals) {
    if (!supplierCostMissing(t)) present += 1;
  }
  if (present === 0) return "none";
  if (present === totals.length) return "full";
  return "partial";
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** Parse a decimal string into an integer scaled by 10^scale, rounding half-up. */
export function toScaled(value: string | number, scale: number): bigint {
  const s = String(value).trim().replace(/,/g, "");
  if (!DECIMAL.test(s)) throw new Error(`Not a decimal number: ${JSON.stringify(value)}`);
  const negative = s.startsWith("-");
  const [int = "0", frac = ""] = s.replace("-", "").split(".");
  const kept = frac.slice(0, scale).padEnd(scale, "0");
  let n = BigInt(int + kept);
  // Round on the first dropped digit.
  if (frac.length > scale && Number(frac[scale]) >= 5) n += 1n;
  return negative ? -n : n;
}

/** Format a scaled integer back to a fixed decimal string. */
export function fromScaled(n: bigint, scale: number): string {
  const negative = n < 0n;
  const digits = (negative ? -n : n).toString().padStart(scale + 1, "0");
  const int = digits.slice(0, digits.length - scale);
  const frac = digits.slice(digits.length - scale);
  return `${negative ? "-" : ""}${int}${scale ? `.${frac}` : ""}`;
}

/** Divide and round half away from zero. */
function divRound(num: bigint, den: bigint): bigint {
  if (den === 0n) return 0n;
  const negative = num < 0n !== den < 0n;
  const a = num < 0n ? -num : num;
  const b = den < 0n ? -den : den;
  const q = (a * 2n + b) / (b * 2n);
  return negative ? -q : q;
}

const CENTS = 2;
const QTY = 2;
const RATE = 4;

/** a (scaled aScale) × b (scaled bScale), rounded to 2 decimals. */
function mulToCents(a: bigint, aScale: number, b: bigint, bScale: number): bigint {
  return divRound(a * b, 10n ** BigInt(aScale + bScale - CENTS));
}

export function lineAmounts(line: LineInput): LineAmounts {
  const qty = toScaled(line.qty, QTY);
  const total = mulToCents(qty, QTY, toScaled(line.unitPrice, CENTS), CENTS);
  const supplierTotal = mulToCents(qty, QTY, toScaled(line.supplierUnitCost || "0", CENTS), CENTS);
  return {
    total: fromScaled(total, CENTS),
    supplierTotal: fromScaled(supplierTotal, CENTS),
    margin: fromScaled(total - supplierTotal, CENTS),
  };
}

/** True when the line has a snapshotted rate (legacy null/blank → not snapshotted). */
export function hasLineWithholdingRate(rate: string | null | undefined): boolean {
  return rate != null && String(rate).trim() !== "";
}

/** Round half-up: one line's total × rate → centavos. Null rate → 0. */
export function lineWithholdingAmountCents(lineTotal: string, rate: string | null | undefined): bigint {
  if (!hasLineWithholdingRate(rate)) return 0n;
  return mulToCents(toScaled(lineTotal, CENTS), CENTS, toScaled(String(rate).trim(), RATE), RATE);
}

function resolveAmounts(line: LineForDocTotals): LineAmounts & { kind: ItemKind } {
  const amounts = "total" in line && line.total != null ? { total: line.total, supplierTotal: line.supplierTotal, margin: line.margin ?? "0.00" } : lineAmounts(line as LineInput);
  return { kind: line.kind, ...amounts };
}

/** Group key for the read-only document withholding summary. */
function groupKey(rate: string, atc: string | null, kind: ItemKind): string {
  // Whole-total ATCs share one bucket across goods/services (same rate on every line).
  // WG010 = legacy alias for WB080 (read-only; must never return to the Settings picker).
  // WV050 is 12% VAT on non-residents — not in the 5% VAT group; group alone if seen.
  if (atc === "WB080" || atc === "WG010" || atc === "WV010/WV020" || atc === "WV010" || atc === "WV020") {
    return `${rate}|${atc}`;
  }
  if (atc === "WV050") return `${rate}|${atc}`;
  return `${rate}|${atc ?? ""}|${kind}`;
}

function summaryCode(rate: string, atc: string | null, kind: ItemKind): string {
  const r = Number(rate).toFixed(4);
  if (kind === "GOODS" && r === "0.0100" && atc === "WI640") return "GOV_GOODS_1";
  if (kind === "SERVICES" && r === "0.0200" && atc === "WI157") return "GOV_SERVICES_2";
  if (kind === "GOODS" && r === "0.0100" && atc === "WI158") return "GOODS_1";
  if (kind === "SERVICES" && r === "0.0200" && atc === "WI160") return "SERVICES_2";
  // WG010 = legacy read-only alias → WB080 / GOV_PT_3. Never offer WG010 in Settings.
  if (r === "0.0300" && (atc === "WB080" || atc === "WG010")) return "GOV_PT_3";
  // 5% VAT withheld — WV010/WV020 only. WV050 is 12% non-resident VAT (not this rate).
  if (r === "0.0500" && (atc === "WV010/WV020" || atc === "WV010" || atc === "WV020")) return "GOV_VAT_5";
  const atcPart = atc ? `_${atc.replace(/\//g, "_")}` : "";
  return `LINE_${kind}_${r.replace(".", "")}${atcPart}`;
}

function summaryLabel(rate: string, atc: string | null, kind: ItemKind): string {
  const pct = ratePctLabel(rate);
  // WG010 legacy → show as WB080. Must never return WG010 to the Settings picker.
  if (atc === "WB080" || atc === "WG010") return `Government percentage tax ${pct} (WB080)`;
  if (atc === "WV010/WV020" || atc === "WV010" || atc === "WV020") {
    return `VAT withheld ${pct} (WV010/WV020)`;
  }
  // WV050 is 12% VAT on non-residents — do not relabel as 5% WV010/WV020.
  if (atc === "WV050") return `VAT (non-resident) ${pct} (WV050)`;
  if (kind === "GOODS" && Number(rate).toFixed(4) === "0.0100" && atc === "WI640") return "Government goods 1% (WI640)";
  if (kind === "SERVICES" && Number(rate).toFixed(4) === "0.0200" && atc === "WI157") return "Government services 2% (WI157)";
  if (kind === "GOODS" && Number(rate).toFixed(4) === "0.0100" && atc === "WI158") return "Private top agent goods 1% (WI158)";
  if (kind === "SERVICES" && Number(rate).toFixed(4) === "0.0200" && atc === "WI160") return "Private top agent services 2% (WI160)";
  const atcBit = atc ? ` (${atc})` : "";
  return `${kind === "GOODS" ? "Goods" : "Services"} ${pct}${atcBit}`;
}

function summaryLineKind(rate: string, atc: string | null, kind: ItemKind): WithholdingLineKind {
  if (atc === "WB080" || atc === "WG010" || (Number(rate).toFixed(4) === "0.0300" && (atc === "WB080" || atc === "WG010" || atc == null))) {
    return "GOV_PT";
  }
  // WV050 is not the 5% VAT group — still whole-total when present on a legacy line.
  if (atc === "WV010/WV020" || atc === "WV010" || atc === "WV020" || atc === "WV050" || Number(rate).toFixed(4) === "0.0500") {
    return "GOV_VAT";
  }
  void kind;
  return kind;
}

function basesFromLines(lines: LineForDocTotals[]): {
  contract: bigint;
  goods: bigint;
  services: bigint;
  supplier: bigint;
} {
  let contract = 0n;
  let goods = 0n;
  let services = 0n;
  let supplier = 0n;
  for (const raw of lines) {
    const line = resolveAmounts(raw);
    const total = toScaled(line.total, CENTS);
    contract += total;
    if (line.kind === "GOODS") goods += total;
    else services += total;
    supplier += toScaled(line.supplierTotal, CENTS);
  }
  return { contract, goods, services, supplier };
}

function baseForPick(lineKind: WithholdingLineKind, bases: { contract: bigint; goods: bigint; services: bigint }): bigint {
  if (lineKind === "GOODS") return bases.goods;
  if (lineKind === "SERVICES") return bases.services;
  // GOV_PT / GOV_VAT — whole total
  return bases.contract;
}

/**
 * Internal breakdown from the quote-level pick list.
 * Each pick is its own line (whole-total rates such as WB080 / GOV_PT stay separate).
 * Total withholding MUST equal the sum of these parts (half-up per part).
 */
export function withholdingBreakdownFromPicks(
  lines: LineForDocTotals[],
  picks: readonly WithholdingSnapshot[],
): WithholdingLine[] {
  const bases = basesFromLines(lines);
  return picks.map((p) => {
    const rate = Number(p.rate).toFixed(4);
    const base = baseForPick(p.lineKind, bases);
    const amount = mulToCents(base, CENTS, toScaled(rate, RATE), RATE);
    return {
      code: p.code,
      label: p.label,
      lineKind: p.lineKind,
      rate,
      atcCode: p.atcCode,
      base: fromScaled(base, CENTS),
      amount: fromScaled(amount, CENTS),
    };
  });
}

/** Sum of breakdown part amounts (string pesos) → pesos string. */
export function sumWithholdingParts(parts: readonly { amount: string }[]): string {
  let total = 0n;
  for (const p of parts) total += toScaled(p.amount, CENTS);
  return fromScaled(total, CENTS);
}

/**
 * Document totals.
 *
 * When `picks` is a non-empty list, the internal breakdown is one row per pick
 * (Goods / Services / whole-total each as its own line) and
 * `withholdingTotal` is exactly the sum of those parts.
 *
 * When `picks` is omitted or empty, totals come from per-line rates
 * (round_half_up(line.total × line.rate) per line, then sum). Null/blank rates
 * contribute 0. The `withholding` array is a read-only grouping for display.
 */
export function docTotals(lines: LineForDocTotals[], picks?: readonly WithholdingSnapshot[]): DocTotals {
  const bases = basesFromLines(lines);
  const { contract, supplier } = bases;

  let withholding: WithholdingLine[];
  let withheld: bigint;

  if (picks && picks.length > 0) {
    withholding = withholdingBreakdownFromPicks(lines, picks);
    withheld = 0n;
    for (const w of withholding) withheld += toScaled(w.amount, CENTS);
  } else {
    type Acc = { rate: string; atc: string | null; kind: ItemKind; base: bigint; amount: bigint };
    const groups = new Map<string, Acc>();
    withheld = 0n;

    for (const raw of lines) {
      const line = resolveAmounts(raw);
      const total = toScaled(line.total, CENTS);

      const rateRaw = raw.withholdingRate;
      if (!hasLineWithholdingRate(rateRaw)) continue;
      const rate = Number(String(rateRaw).trim()).toFixed(4);
      if (rate === "0.0000") continue; // explicit zero — no withholding row
      const atc = raw.withholdingAtc != null && String(raw.withholdingAtc).trim() !== "" ? String(raw.withholdingAtc).trim() : null;
      const amount = lineWithholdingAmountCents(line.total, rate);
      withheld += amount;

      const key = groupKey(rate, atc, line.kind);
      const prev = groups.get(key);
      if (prev) {
        prev.base += total;
        prev.amount += amount;
      } else {
        groups.set(key, { rate, atc, kind: line.kind, base: total, amount });
      }
    }

    withholding = [...groups.values()].map((g) => ({
      code: summaryCode(g.rate, g.atc, g.kind),
      label: summaryLabel(g.rate, g.atc, g.kind),
      lineKind: summaryLineKind(g.rate, g.atc, g.kind),
      rate: g.rate,
      atcCode: g.atc,
      base: fromScaled(g.base, CENTS),
      amount: fromScaled(g.amount, CENTS),
    }));
  }

  const netReceived = contract - withheld;
  // Margin is contract − supplier. Withholding is a tax credit (cash timing), not a cost —
  // it must never shrink margin or make a profitable deal look like a loss.
  // A blank supplier cost still stores netMarginPct 100.00 so approval does not treat it as a low margin.
  const netMargin = contract - supplier;
  const pct = contract === 0n ? 0n : divRound(netMargin * 10_000n, contract);
  const supplierTotals = lines.map((raw) => resolveAmounts(raw).supplierTotal);

  return {
    contractPrice: fromScaled(contract, CENTS),
    withholding,
    withholdingTotal: fromScaled(withheld, CENTS),
    netReceived: fromScaled(netReceived, CENTS),
    supplierCost: fromScaled(supplier, CENTS),
    netMargin: fromScaled(netMargin, CENTS),
    netMarginPct: fromScaled(pct, 2),
    supplierCostState: supplierCostStateFromSupplierTotals(supplierTotals),
  };
}

/** Read-only document snapshot derived from line rates (no second math source). */
export function withholdingSnapshotFromLines(lines: LineForDocTotals[]): WithholdingSnapshot[] {
  return docTotals(lines).withholding.map(({ code, label, lineKind, rate, atcCode }) => ({
    code,
    label,
    lineKind,
    rate,
    atcCode,
  }));
}

/** Rate fraction ("0.0100") → percent label ("1%", "1.5%"). */
export function ratePctLabel(rate: string): string {
  const hundredths = toScaled(rate, RATE); // 0.0150 → 150 (= 1.50%)
  return `${fromScaled(hundredths, 2).replace(/\.?0+$/, "")}%`;
}

/** Percent input ("1.5") → rate fraction string with 4 decimals ("0.0150"). */
export function pctToRate(pct: string): string {
  return fromScaled(toScaled(pct, 2), RATE);
}

/** "Needs approval" (display only): margin below the setting, or total above it. */
export function approvalReasons(
  totals: Pick<DocTotals, "contractPrice" | "netMarginPct">,
  approval: { marginBelowPct: number; totalAbove: number },
): string[] {
  const reasons: string[] = [];
  if (toScaled(totals.netMarginPct, 2) < toScaled(String(approval.marginBelowPct), 2)) {
    reasons.push(`Margin is below ${approval.marginBelowPct}%`);
  }
  if (toScaled(totals.contractPrice, CENTS) > toScaled(String(approval.totalAbove), CENTS)) {
    reasons.push("Total is above the approval limit");
  }
  return reasons;
}
