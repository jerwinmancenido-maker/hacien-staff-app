// Renders an audit/settings before → after diff compactly.

import { auditDisplayValue } from "@/lib/audit";

type Json = unknown;

function humanKey(k: string): string {
  const words = k
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return words.replace(/^./, (c) => c.toUpperCase());
}

/**
 * S-101: plain readable lines, never raw JSON. An items array renders as
 * one "Description: …, Qty: …, …" line per item, joined by "; ".
 */
export function readableDiffValue(v: Json): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) {
    if (!v.length) return "—";
    // A long items list dumps as one giant line in the Activity feed.
    // Show the first 3, then how many more there are.
    const shown = v.slice(0, 3).map((el) => readableDiffValue(el));
    if (v.length > 3) shown.push(`… and ${v.length - 3} more`);
    return shown.join("; ");
  }
  if (typeof v === "object") {
    const parts = Object.entries(v as Record<string, Json>)
      .filter(([, val]) => val !== null && val !== undefined && val !== "")
      .map(([k, val]) => `${humanKey(k)}: ${readableDiffValue(val)}`);
    return parts.length ? parts.join(", ") : "—";
  }
  return String(v);
}

export function DiffView({ before, after }: { before: Json; after: Json }) {
  const b = (before && typeof before === "object" ? before : {}) as Record<string, Json>;
  const a = (after && typeof after === "object" ? after : {}) as Record<string, Json>;
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]));
  if (!keys.length) return null;
  return (
    <div className="diff">
      {keys.map((k) => {
        const bv = auditDisplayValue(k, b[k]);
        const av = auditDisplayValue(k, a[k]);
        if (Array.isArray(bv) && Array.isArray(av)) {
          const line = diffArrayItems(bv, av);
          if (line === "—") return null;
          return (
            <div key={k}>
              {humanKey(k)}: {line}
            </div>
          );
        }
        return (
          <div key={k}>
            {humanKey(k)}: {k in b && <span className="old">{readableDiffValue(bv)}</span>} {k in b && "→ "}
            <span>{readableDiffValue(av)}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Diff for a list of objects (e.g. quote/SO items): match elements by
 * description, show only what changed, and only the fields that changed.
 * Identical elements are skipped, so an edit to one line does not dump
 * the whole list twice. Added/removed elements render in full.
 */
export function diffArrayItems(before: Json[], after: Json[]): string {
  const keyOf = (el: Json): string => {
    if (el && typeof el === "object" && !Array.isArray(el)) {
      const o = el as Record<string, Json>;
      if (typeof o.description === "string" && o.description) return o.description;
    }
    return JSON.stringify(el);
  };
  const beforeByKey = new Map<string, Json>();
  for (const el of before) beforeByKey.set(keyOf(el), el);
  const lines: string[] = [];
  const matched = new Set<string>();
  for (const el of after) {
    const k = keyOf(el);
    matched.add(k);
    const b = beforeByKey.get(k);
    if (b === undefined) {
      lines.push(`Added: ${readableDiffValue(el)}`);
      continue;
    }
    if (JSON.stringify(b) === JSON.stringify(el)) continue;
    if (!b || typeof b !== "object" || Array.isArray(b) || !el || typeof el !== "object" || Array.isArray(el)) {
      lines.push(`${readableDiffValue(b)} → ${readableDiffValue(el)}`);
      continue;
    }
    const bo = b as Record<string, Json>;
    const ao = el as Record<string, Json>;
    const changed: string[] = [];
    for (const fk of Array.from(new Set([...Object.keys(bo), ...Object.keys(ao)]))) {
      const bv = auditDisplayValue(fk, bo[fk]);
      const av = auditDisplayValue(fk, ao[fk]);
      if (JSON.stringify(bv) !== JSON.stringify(av)) {
        changed.push(`${humanKey(fk)}: ${readableDiffValue(bv)} → ${readableDiffValue(av)}`);
      }
    }
    lines.push(changed.length ? `${k} — ${changed.join(", ")}` : `${k} — changed`);
  }
  for (const el of before) {
    const k = keyOf(el);
    if (!matched.has(k)) lines.push(`Removed: ${readableDiffValue(el)}`);
  }
  return lines.length ? lines.join("; ") : "—";
}
