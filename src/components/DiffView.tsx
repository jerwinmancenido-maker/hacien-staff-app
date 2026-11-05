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
      {keys.map((k) => (
        <div key={k}>
          {humanKey(k)}: {k in b && <span className="old">{readableDiffValue(auditDisplayValue(k, b[k]))}</span>} {k in b && "→ "}
          <span>{readableDiffValue(auditDisplayValue(k, a[k]))}</span>
        </div>
      ))}
    </div>
  );
}
