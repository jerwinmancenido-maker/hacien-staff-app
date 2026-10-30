"use client";

import { useRouter } from "next/navigation";

/** Year + quarter picker for tax worksheets. */
export function TaxQuarterFilters({
  basePath,
  year,
  quarter,
  exportHref,
  printHref,
  showQuarter = true,
}: {
  basePath: string;
  year: number;
  quarter: number;
  exportHref?: string;
  printHref?: string;
  /** When false, only the year is shown (sales summary). */
  showQuarter?: boolean;
}) {
  const router = useRouter();
  const years = Array.from({ length: 8 }, (_, i) => year - 3 + i).filter((y) => y >= 2000 && y <= 2100);

  return (
    <form
      className="filters"
      method="get"
      style={{ marginBottom: 16, flexWrap: "wrap", gap: 8, display: "flex", alignItems: "center" }}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const params = new URLSearchParams();
        const y = String(fd.get("year") ?? "");
        const q = String(fd.get("quarter") ?? "");
        if (y) params.set("year", y);
        if (showQuarter && q) params.set("quarter", q);
        const qs = params.toString();
        router.push(qs ? `${basePath}?${qs}` : basePath);
      }}
    >
      <label className="small">
        Year{" "}
        <select name="year" defaultValue={year} aria-label="Tax year">
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      {showQuarter ? (
        <label className="small">
          Quarter{" "}
          <select name="quarter" defaultValue={quarter} aria-label="Quarter">
            <option value={1}>Q1 (Jan–Mar)</option>
            <option value={2}>Q2 (Apr–Jun)</option>
            <option value={3}>Q3 (Jul–Sep)</option>
            <option value={4}>Q4 (Oct–Dec)</option>
          </select>
        </label>
      ) : null}
      <button className="btn btn-secondary" type="submit">
        Apply
      </button>
      {exportHref ? (
        <a className="btn btn-secondary" href={exportHref}>
          Export CSV
        </a>
      ) : null}
      {printHref ? (
        <a className="btn btn-secondary" href={printHref} target="_blank" rel="noreferrer">
          Print / PDF
        </a>
      ) : null}
    </form>
  );
}
