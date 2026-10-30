// Receiving rules: no over-receiving. The server runs this inside the RR
// transaction after locking the PO lines (SELECT … FOR UPDATE), so two people
// receiving at once can't both take the last units.

import { fromScaled, toScaled } from "../quotes/calc";

export type OpenLine = { id: string; description: string; qty: string; receivedQty: string };
export type ReceiptEntry = { lineId: string; qty: string };

/** Ordered − received, never below 0. */
export function remainingQty(line: Pick<OpenLine, "qty" | "receivedQty">): string {
  const r = toScaled(line.qty, 2) - toScaled(line.receivedQty, 2);
  return fromScaled(r < 0n ? 0n : r, 2);
}

export type ReceiptCheck = { ok: true; entries: ReceiptEntry[] } | { ok: false; errors: Record<string, string>; message: string };

/**
 * Checks the quantities typed on the receiving form. 0 or blank = skip the line.
 * Returns the non-zero entries, or per-line errors keyed by line id.
 */
export function checkReceipt(lines: readonly OpenLine[], entries: readonly ReceiptEntry[]): ReceiptCheck {
  const errors: Record<string, string> = {};
  const byId = new Map(lines.map((l) => [l.id, l]));
  const kept: ReceiptEntry[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const line = byId.get(e.lineId);
    if (!line) {
      errors[e.lineId] = "This line isn't on the PO.";
      continue;
    }
    if (seen.has(e.lineId)) {
      errors[e.lineId] = "This line is listed twice.";
      continue;
    }
    seen.add(e.lineId);
    const raw = (e.qty ?? "").trim().replace(/,/g, "");
    if (raw === "") continue;
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(raw)) {
      errors[e.lineId] = "Enter a quantity with up to 2 decimals.";
      continue;
    }
    const q = toScaled(raw, 2);
    if (q === 0n) continue;
    const left = toScaled(line.qty, 2) - toScaled(line.receivedQty, 2);
    if (q > left) {
      errors[e.lineId] = `Only ${fromScaled(left < 0n ? 0n : left, 2).replace(/\.00$/, "")} left to receive on “${line.description.split("\n")[0]}”.`;
      continue;
    }
    kept.push({ lineId: e.lineId, qty: fromScaled(q, 2) });
  }
  if (Object.keys(errors).length) {
    const over = Object.values(errors).some((m) => m.startsWith("Only "));
    return { ok: false, errors, message: over ? "Can't receive more than was ordered. Check the lines marked below." : "Check the lines marked below." };
  }
  if (!kept.length) return { ok: false, errors: {}, message: "Enter a quantity for at least one line." };
  return { ok: true, entries: kept };
}

/** receivedQty after adding (sign 1) or reversing (sign −1) a receipt; throws if it would go out of 0…ordered. */
export function applyReceipt(line: Pick<OpenLine, "qty" | "receivedQty">, qty: string, sign: 1 | -1): string {
  const next = toScaled(line.receivedQty, 2) + BigInt(sign) * toScaled(qty, 2);
  if (next < 0n || next > toScaled(line.qty, 2)) throw new Error("Received quantity out of range.");
  return fromScaled(next, 2);
}
