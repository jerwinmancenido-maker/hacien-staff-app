// Delivery receipt rules for sales orders: partial deliveries allowed,
// cumulative delivered quantity can never exceed ordered quantity.
// Pure (no DB) so unit tests cover every boundary without MySQL.

import { fromScaled, toScaled } from "../quotes/calc";

export type OpenDeliveryLine = { id: string; description: string; qty: string; deliveredQty: string };
export type DeliveryEntry = { salesOrderItemId: string; qty: string };

/** Ordered − delivered, never below 0. */
export function remainingDeliveryQty(line: Pick<OpenDeliveryLine, "qty" | "deliveredQty">): string {
  const r = toScaled(line.qty, 2) - toScaled(line.deliveredQty, 2);
  return fromScaled(r < 0n ? 0n : r, 2);
}

export type DeliveryCheck =
  | { ok: true; entries: DeliveryEntry[] }
  | { ok: false; errors: Record<string, string>; message: string };

/**
 * Checks quantities typed on the delivery form. 0 or blank = skip the line.
 * Rejects if cumulative delivered would exceed ordered.
 */
export function checkDelivery(
  lines: readonly OpenDeliveryLine[],
  entries: readonly DeliveryEntry[],
): DeliveryCheck {
  const errors: Record<string, string> = {};
  const byId = new Map(lines.map((l) => [l.id, l]));
  const kept: DeliveryEntry[] = [];
  const seen = new Set<string>();

  for (const e of entries) {
    const line = byId.get(e.salesOrderItemId);
    if (!line) {
      errors[e.salesOrderItemId] = "This line isn't on the sales order.";
      continue;
    }
    if (seen.has(e.salesOrderItemId)) {
      errors[e.salesOrderItemId] = "This line is listed twice.";
      continue;
    }
    seen.add(e.salesOrderItemId);
    const raw = (e.qty ?? "").trim().replace(/,/g, "");
    if (raw === "") continue;
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(raw)) {
      errors[e.salesOrderItemId] = "Enter a quantity with up to 2 decimals.";
      continue;
    }
    const q = toScaled(raw, 2);
    if (q === 0n) continue;
    if (q < 0n) {
      errors[e.salesOrderItemId] = "Quantity cannot be negative.";
      continue;
    }
    const left = toScaled(line.qty, 2) - toScaled(line.deliveredQty, 2);
    if (q > left) {
      errors[e.salesOrderItemId] = `Only ${fromScaled(left < 0n ? 0n : left, 2).replace(/\.00$/, "")} left to deliver on “${line.description.split("\n")[0]}”.`;
      continue;
    }
    kept.push({ salesOrderItemId: e.salesOrderItemId, qty: fromScaled(q, 2) });
  }

  if (Object.keys(errors).length) {
    const over = Object.values(errors).some((m) => m.startsWith("Only "));
    return {
      ok: false,
      errors,
      message: over
        ? "Delivered quantity cannot exceed ordered. Check the lines marked below."
        : "Check the lines marked below.",
    };
  }
  if (!kept.length) {
    return { ok: false, errors: {}, message: "Enter a quantity for at least one item." };
  }
  return { ok: true, entries: kept };
}

/** deliveredQty after adding (sign 1) or reversing (sign −1) a delivery; throws if it would go out of 0…ordered. */
export function applyDelivery(
  line: Pick<OpenDeliveryLine, "qty" | "deliveredQty">,
  qty: string,
  sign: 1 | -1,
): string {
  const next = toScaled(line.deliveredQty, 2) + BigInt(sign) * toScaled(qty, 2);
  if (next < 0n || next > toScaled(line.qty, 2)) {
    throw new Error("Delivered quantity out of range.");
  }
  return fromScaled(next, 2);
}

export type SoDeliveryProgress = {
  total: number;
  delivered: number;
  fullyDelivered: boolean;
  label: string;
};

/** Summary progress for Deliveries section: e.g. "2 of 5 delivered" or "Fully delivered". */
export function soDeliveryProgress(
  items: readonly { qty: string; deliveredQty: string }[],
): SoDeliveryProgress {
  const total = items.length;
  const delivered = items.filter((i) => {
    const ordered = toScaled(i.qty, 2);
    const del = toScaled(i.deliveredQty, 2);
    return ordered > 0n && del >= ordered;
  }).length;
  const fullyDelivered = total > 0 && delivered === total;
  const label = fullyDelivered ? "Fully delivered" : `${delivered} of ${total} delivered`;
  return { total, delivered, fullyDelivered, label };
}

/** True when at least one live line still has ordered qty left to deliver. */
export function soHasRemainingToDeliver(
  items: readonly Pick<OpenDeliveryLine, "qty" | "deliveredQty">[],
): boolean {
  return items.some((i) => toScaled(remainingDeliveryQty(i), 2) > 0n);
}

/**
 * Overview deliveries line (same counts as Deliveries tab / auto-close).
 * e.g. "2 of 5 lines delivered · 3 left to deliver" or "Fully delivered".
 */
export function soDeliveryOverviewLabel(
  progress: Pick<SoDeliveryProgress, "total" | "delivered" | "fullyDelivered">,
): string {
  if (progress.fullyDelivered) return "Fully delivered";
  const left = progress.total - progress.delivered;
  return `${progress.delivered} of ${progress.total} lines delivered · ${left} left to deliver`;
}
