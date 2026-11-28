// Compact per-document progress bars for the order lists (ERP adoption
// item 7): one labelled mini-bar per measure — Delivered / Billed / Paid on
// sales orders, Received / Billed / Paid on purchase orders. Server-safe
// (no hooks); the list pages render these into DataTable cells.
//
// A measure whose pct is null is omitted entirely (no fake 0 bars); when
// every measure is null the component renders nothing. The printed number
// is the true percent (over 100 stays over 100); only the bar fill clamps
// to the track. On phones (≤640px) the track hides and the label + percent
// text stay, per the item brief.

import { percentFill, percentLabel } from "@/lib/progress";

export type ProgressMeasure = { label: string; pct: number | null };

export function ProgressBars({ measures, context }: { measures: readonly ProgressMeasure[]; context: string }) {
  const shown = measures.filter((m): m is { label: string; pct: number } => m.pct !== null);
  if (shown.length === 0) return null;
  return (
    <div className="prog">
      {shown.map((m) => {
        const fill = percentFill(m.pct);
        const text = percentLabel(m.pct);
        return (
          <div className="prog-row" key={m.label}>
            <span className="prog-label">{m.label}</span>
            <span
              className="prog-bar"
              role="meter"
              aria-label={`${context}: ${m.label} ${text}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(fill)}
            >
              <span style={{ width: `${fill}%` }} className={fill >= 100 ? "full" : ""} />
            </span>
            <span className="prog-pct">{text}</span>
          </div>
        );
      })}
    </div>
  );
}
