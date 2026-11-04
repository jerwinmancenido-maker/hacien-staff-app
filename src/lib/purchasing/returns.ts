// S-50: pure quantity check for a supplier return. A line can return at most
// what was received on it (receivedQty is the locked, current value).
import { fromScaled, toScaled } from "../quotes/calc";

export type ReturnableLine = { id: string; description: string; receivedQty: string };
export type ReturnEntry = { lineId: string; qty: string };

export function checkReturn(
  lines: readonly ReturnableLine[],
  entries: readonly ReturnEntry[],
): { ok: true; entries: { lineId: string; qty: string }[] } | { ok: false; message: string; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const byId = new Map(lines.map((l) => [l.id, l]));
  const seen = new Set<string>();
  const kept: { lineId: string; qty: string }[] = [];
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
    if (q > toScaled(line.receivedQty, 2)) {
      errors[e.lineId] = `Only ${fromScaled(toScaled(line.receivedQty, 2), 2).replace(/\.00$/, "")} received on “${line.description.split("\n")[0]}” to return.`;
      continue;
    }
    kept.push({ lineId: e.lineId, qty: fromScaled(q, 2) });
  }
  if (Object.keys(errors).length) return { ok: false, message: "Fix the quantities marked below.", errors };
  if (!kept.length) return { ok: false, message: "Enter a quantity to return on at least one line.", errors: {} };
  return { ok: true, entries: kept };
}
