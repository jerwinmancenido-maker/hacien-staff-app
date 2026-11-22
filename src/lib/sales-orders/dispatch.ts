// Dispatch queue: OPEN sales orders that still have undelivered quantities,
// oldest first — the list whoever prepares deliveries works from. Read-only —
// no writes anywhere in this module.
//
// Scope rules:
// - Own-company documents only (businessId null), the same wall the tax and
//   Books surfaces apply: another business's orders never appear here.
// - An order is on the queue only while at least one line still has quantity
//   to deliver. Fully delivered orders drop off; VOID / CLOSED are out.
// - Remaining quantities come from remainingDeliveryQty() (delivery.ts) —
//   the same math the SO Deliveries tab uses, never recomputed here.

import { db } from "../db";
import { money, ymd } from "../documents/common";
import { fromScaled, toScaled } from "../quotes/calc";
import { billingToday, calendarDaysBetween } from "../billing/dates";
import { remainingDeliveryQty } from "./delivery";

export type DispatchInputLine = {
  description: string;
  qty: string;
  deliveredQty: string;
  unit: string;
};

export type DispatchInputRow = {
  id: string;
  number: string;
  customerName: string;
  /** SO date (DATE column, stored as 00:00 UTC of that calendar day). */
  date: Date;
  status: string;
  /** The SO's chosen delivery address, already fallen back to the customer's
   * address by the loader (the packing list's F22 rule). */
  deliveryAddress: string | null;
  contactName: string | null;
  contactPhone: string | null;
  lines: readonly DispatchInputLine[];
};

export type DispatchLine = {
  description: string;
  qtyRemaining: string;
  unit: string;
};

export type DispatchRow = {
  id: string;
  number: string;
  customerName: string;
  /** SO date as YYYY-MM-DD. */
  date: string;
  daysOpen: number;
  deliveryAddress: string | null;
  contactName: string | null;
  contactPhone: string | null;
  lines: DispatchLine[];
  /** Sum of the remaining quantities across the order's lines. */
  unitsRemaining: string;
  /** The same remaining quantities grouped by unit, first-seen unit order —
   * what the page renders; unitsRemaining stays as the blended sum. */
  unitsByUnit: { unit: string; qty: string }[];
};

export type DispatchSummary = {
  /** Orders oldest first — the longest-waiting delivery gets eyes first. */
  rows: DispatchRow[];
  orderCount: number;
  totalUnitsRemaining: string;
  /** totalUnitsRemaining grouped by unit, first-seen unit order. */
  totalByUnit: { unit: string; qty: string }[];
};

/** Adds qty into a first-seen-ordered per-unit grouping (scaled sums). */
function addUnitQty(groups: { unit: string; qty: bigint }[], unit: string, qty: bigint): void {
  const g = groups.find((x) => x.unit === unit);
  if (g) g.qty += qty;
  else groups.push({ unit, qty });
}

/** Pure builder so unit tests pin the queue rules without a database. */
export function buildDispatchQueue(
  rows: readonly DispatchInputRow[],
  today: Date = billingToday(),
): DispatchSummary {
  const kept: DispatchRow[] = [];
  let totalUnits = 0n;
  const totalByUnitScaled: { unit: string; qty: bigint }[] = [];
  for (const r of rows) {
    if (r.status !== "OPEN") continue;
    const lines: DispatchLine[] = [];
    let units = 0n;
    const rowByUnit: { unit: string; qty: bigint }[] = [];
    for (const l of r.lines) {
      const left = remainingDeliveryQty(l);
      if (toScaled(left, 2) <= 0n) continue;
      lines.push({ description: l.description, qtyRemaining: left, unit: l.unit });
      units += toScaled(left, 2);
      addUnitQty(rowByUnit, l.unit, toScaled(left, 2));
    }
    if (lines.length === 0) continue;
    totalUnits += units;
    for (const g of rowByUnit) addUnitQty(totalByUnitScaled, g.unit, g.qty);
    kept.push({
      id: r.id,
      number: r.number,
      customerName: r.customerName,
      date: ymd(r.date)!,
      daysOpen: calendarDaysBetween(r.date, today),
      deliveryAddress: r.deliveryAddress,
      contactName: r.contactName,
      contactPhone: r.contactPhone,
      lines,
      unitsRemaining: fromScaled(units, 2),
      unitsByUnit: rowByUnit.map((g) => ({ unit: g.unit, qty: fromScaled(g.qty, 2) })),
    });
  }
  kept.sort((a, b) => b.daysOpen - a.daysOpen || a.number.localeCompare(b.number));
  return {
    rows: kept,
    orderCount: kept.length,
    totalUnitsRemaining: fromScaled(totalUnits, 2),
    totalByUnit: totalByUnitScaled.map((g) => ({ unit: g.unit, qty: fromScaled(g.qty, 2) })),
  };
}

/** DB loader: OPEN, own-company sales orders with lines and contact. */
export async function listDispatchQueue(today: Date = billingToday()): Promise<DispatchSummary> {
  const rows = await db.salesOrder.findMany({
    where: { status: "OPEN", businessId: null },
    include: {
      customer: { select: { name: true, address: true } },
      contact: { select: { name: true, phone: true } },
      items: {
        orderBy: { sortOrder: "asc" },
        select: { description: true, qty: true, deliveredQty: true, unit: true },
      },
    },
    orderBy: [{ date: "asc" }, { number: "asc" }],
  });
  return buildDispatchQueue(
    rows.map((r) => ({
      id: r.id,
      number: r.number,
      customerName: r.customer.name,
      date: r.date,
      status: r.status,
      // F22 rule, same as the packing list: the SO's chosen delivery address
      // wins; the customer's free-text address is only a fallback.
      deliveryAddress: r.deliveryAddress ?? r.customer.address,
      contactName: r.contact?.name ?? null,
      contactPhone: r.contact?.phone ?? null,
      lines: r.items.map((i) => ({
        description: i.description,
        qty: money(i.qty),
        deliveredQty: money(i.deliveredQty),
        unit: i.unit,
      })),
    })),
    today,
  );
}
