// 3-way match for one PO: what we ordered (PO qty × PO unit cost), what we
// received (posted receiving reports), and what the supplier billed (non-void
// bills). Pure: the PO page passes the rows in. Money/qty use exact BigInt math.

import { fromScaled, toScaled } from "../quotes/calc";

export type MatchPoLine = { id: string; description: string; unit: string; qty: string; unitCost: string; receivedQty: string };
export type MatchBillLine = { purchaseOrderItemId: string; qty: string; unitPrice: string };
export type MatchBill = { id: string; billNumber: string; amount: string; items: MatchBillLine[] };

export type LineFlag = "BILLED_MORE_THAN_RECEIVED" | "RECEIVED_LESS_THAN_ORDERED" | "PRICE_DIFFERS";
export type LineStatus = "MATCHED" | "QTY_MISMATCH" | "PRICE_MISMATCH";
export type HeaderFlag = { code: "BILL_LINES_DIFFER" | "BILLED_DIFFERS_FROM_RECEIVED"; message: string; amount: string };

export const LINE_STATUS_LABELS: Record<LineStatus, string> = { MATCHED: "Matched", QTY_MISMATCH: "Qty mismatch", PRICE_MISMATCH: "Price mismatch" };
export const LINE_FLAG_LABELS: Record<LineFlag, string> = {
  BILLED_MORE_THAN_RECEIVED: "Billed more than received",
  RECEIVED_LESS_THAN_ORDERED: "Received less than ordered",
  PRICE_DIFFERS: "Unit price differs from PO",
};

export type MatchLine = {
  id: string;
  description: string;
  unit: string;
  orderedQty: string;
  unitCost: string;
  orderedAmount: string;
  receivedQty: string;
  receivedAmount: string;
  billedQty: string;
  billedAmount: string;
  /** Average billed unit price (2 dp), null when nothing is billed on this line. */
  billedUnitPrice: string | null;
  /** billed amount − billed qty × PO unit cost (positive = billed above PO price). */
  priceDifference: string;
  flags: LineFlag[];
  status: LineStatus;
};

export type MatchResult = {
  lines: MatchLine[];
  orderedTotal: string;
  receivedTotal: string;
  /** Sum of bill header amounts. */
  billedTotal: string;
  /** Sum of billed lines (only bills that have line detail). */
  billedLinesTotal: string;
  headerFlags: HeaderFlag[];
  status: "MATCHED" | "MISMATCH" | "NOT_BILLED";
};

const Q = 2;
const C = 2;
const fmt = (n: bigint) => fromScaled(n, C);
/** qty (2 dp) × price (2 dp) → cents, half away from zero. */
function mul(qty: bigint, price: bigint): bigint {
  const p = qty * price;
  const neg = p < 0n;
  const a = neg ? -p : p;
  const r = (a + 50n) / 100n;
  return neg ? -r : r;
}

export function threeWayMatch(poLines: readonly MatchPoLine[], bills: readonly MatchBill[]): MatchResult {
  const billed = new Map<string, { qty: bigint; amount: bigint; prices: Set<bigint> }>();
  let billedLinesTotal = 0n;
  const headerFlags: HeaderFlag[] = [];
  for (const b of bills) {
    let linesSum = 0n;
    for (const i of b.items) {
      const q = toScaled(i.qty, Q);
      const p = toScaled(i.unitPrice, C);
      const amt = mul(q, p);
      linesSum += amt;
      const cur = billed.get(i.purchaseOrderItemId) ?? { qty: 0n, amount: 0n, prices: new Set<bigint>() };
      cur.qty += q;
      cur.amount += amt;
      cur.prices.add(p);
      billed.set(i.purchaseOrderItemId, cur);
    }
    billedLinesTotal += linesSum;
    const header = toScaled(b.amount, C);
    if (b.items.length && header !== linesSum) {
      headerFlags.push({
        code: "BILL_LINES_DIFFER",
        message: `Bill ${b.billNumber}: amount ${fmt(header)} ≠ sum of its lines ${fmt(linesSum)}`,
        amount: fmt(header - linesSum),
      });
    }
  }

  let orderedTotal = 0n;
  let receivedTotal = 0n;
  const lines: MatchLine[] = poLines.map((l) => {
    const ordered = toScaled(l.qty, Q);
    const received = toScaled(l.receivedQty, Q);
    const cost = toScaled(l.unitCost, C);
    const b = billed.get(l.id) ?? { qty: 0n, amount: 0n, prices: new Set<bigint>() };
    const orderedAmount = mul(ordered, cost);
    const receivedAmount = mul(received, cost);
    orderedTotal += orderedAmount;
    receivedTotal += receivedAmount;
    const priceDifference = b.amount - mul(b.qty, cost);
    const flags: LineFlag[] = [];
    if (b.qty > received) flags.push("BILLED_MORE_THAN_RECEIVED");
    if (received < ordered) flags.push("RECEIVED_LESS_THAN_ORDERED");
    if ([...b.prices].some((p) => p !== cost)) flags.push("PRICE_DIFFERS");
    const status: LineStatus = flags.includes("PRICE_DIFFERS")
      ? "PRICE_MISMATCH"
      : flags.length || b.qty !== received
        ? "QTY_MISMATCH"
        : "MATCHED";
    return {
      id: l.id,
      description: l.description,
      unit: l.unit,
      orderedQty: fromScaled(ordered, Q),
      unitCost: fmt(cost),
      orderedAmount: fmt(orderedAmount),
      receivedQty: fromScaled(received, Q),
      receivedAmount: fmt(receivedAmount),
      billedQty: fromScaled(b.qty, Q),
      billedAmount: fmt(b.amount),
      billedUnitPrice: b.qty > 0n ? fmt((b.amount * 100n + b.qty / 2n) / b.qty) : null,
      priceDifference: fmt(priceDifference),
      flags,
      status,
    };
  });

  const billedTotal = bills.reduce((acc, b) => acc + toScaled(b.amount, C), 0n);
  if (bills.length && billedTotal !== receivedTotal) {
    headerFlags.push({
      code: "BILLED_DIFFERS_FROM_RECEIVED",
      message: `Billed ${fmt(billedTotal)} ≠ PO value of received qty ${fmt(receivedTotal)}`,
      amount: fmt(billedTotal - receivedTotal),
    });
  }
  const status = !bills.length ? "NOT_BILLED" : headerFlags.length || lines.some((l) => l.status !== "MATCHED") ? "MISMATCH" : "MATCHED";
  return {
    lines,
    orderedTotal: fmt(orderedTotal),
    receivedTotal: fmt(receivedTotal),
    billedTotal: fmt(billedTotal),
    billedLinesTotal: fmt(billedLinesTotal),
    headerFlags,
    status,
  };
}
