// Quote / sales order math. Pure and dependency-free (the browser editor, the
// server and prisma/seed.mts all use it), with exact decimal arithmetic on
// scaled BigInts so there are no floating-point surprises.
//
// Money is pesos with 2 decimals; quantities have 2 decimals; withholding rates
// are fractions with 4 decimals (0.0100 = 1%). Rounding is half-up (away from
// zero) to 2 decimals, done per line and per withholding rate.
//
// HACIEN is non-VAT: the withholding base is the gross contract price, never
// divided by 1.12.

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

export type WithholdingLine = WithholdingSnapshot & { base: string; amount: string };

export type DocTotals = {
  /** Sum of buyer line totals. */
  contractPrice: string;
  withholding: WithholdingLine[];
  withholdingTotal: string;
  /** Contract price − withholding. */
  netReceived: string;
  /** Sum of supplier totals. */
  supplierCost: string;
  /** Net received − supplier cost. */
  netMargin: string;
  /** Net margin as % of the contract price (2 dp); "0.00" when the contract price is 0. */
  netMarginPct: string;
};

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

/**
 * Document totals. Goods rates apply to the goods lines, services rates to the
 * services lines, and the government percentage tax / VAT rates to the whole
 * contract price.
 */
export function docTotals(lines: (LineInput | (Pick<LineInput, "kind"> & LineAmounts))[], rates: WithholdingSnapshot[]): DocTotals {
  let contract = 0n;
  let goods = 0n;
  let services = 0n;
  let supplier = 0n;
  for (const line of lines) {
    const amounts = "total" in line ? line : lineAmounts(line);
    const total = toScaled(amounts.total, CENTS);
    contract += total;
    if (line.kind === "GOODS") goods += total;
    else services += total;
    supplier += toScaled(amounts.supplierTotal, CENTS);
  }

  const baseFor = (kind: WithholdingLineKind) => (kind === "GOODS" ? goods : kind === "SERVICES" ? services : contract);
  let withheld = 0n;
  const withholding = rates.map((r) => {
    const base = baseFor(r.lineKind);
    const amount = mulToCents(base, CENTS, toScaled(r.rate, RATE), RATE);
    withheld += amount;
    return { ...r, base: fromScaled(base, CENTS), amount: fromScaled(amount, CENTS) };
  });

  const netReceived = contract - withheld;
  const netMargin = netReceived - supplier;
  // Percent with 2 decimals = netMargin / contract × 100, scaled by 100.
  const pct = contract === 0n ? 0n : divRound(netMargin * 10_000n, contract);

  return {
    contractPrice: fromScaled(contract, CENTS),
    withholding,
    withholdingTotal: fromScaled(withheld, CENTS),
    netReceived: fromScaled(netReceived, CENTS),
    supplierCost: fromScaled(supplier, CENTS),
    netMargin: fromScaled(netMargin, CENTS),
    netMarginPct: fromScaled(pct, 2),
  };
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
