// Renders an audit/settings before → after diff compactly.

type Json = unknown;

function show(v: Json): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
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
          {k}: {k in b && <span className="old">{show(b[k])}</span>} {k in b && "→ "}
          <span>{show(a[k])}</span>
        </div>
      ))}
    </div>
  );
}
