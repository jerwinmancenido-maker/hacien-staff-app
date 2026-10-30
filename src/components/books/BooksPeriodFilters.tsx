"use client";

import { useRouter } from "next/navigation";

/** Month / custom date range for a Books register. Defaults come from the server (current Manila month). */
export function BooksPeriodFilters({
  basePath,
  from,
  to,
  exportHref,
  printHref,
}: {
  basePath: string;
  from: string;
  to: string;
  exportHref: string;
  printHref: string;
}) {
  const router = useRouter();

  return (
    <form
      className="filters"
      method="get"
      style={{ marginBottom: 16, flexWrap: "wrap", gap: 8, display: "flex", alignItems: "center" }}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const params = new URLSearchParams();
        const f = String(fd.get("from") ?? "");
        const t = String(fd.get("to") ?? "");
        if (f) params.set("from", f);
        if (t) params.set("to", t);
        const q = params.toString();
        router.push(q ? `${basePath}?${q}` : basePath);
      }}
    >
      <label className="small">
        From <input type="date" name="from" defaultValue={from} required />
      </label>
      <label className="small">
        To <input type="date" name="to" defaultValue={to} required />
      </label>
      <button className="btn btn-secondary" type="submit">
        Apply dates
      </button>
      <a className="btn btn-secondary" href={exportHref}>
        Export CSV
      </a>
      <a className="btn btn-secondary" href={printHref} target="_blank" rel="noreferrer">
        Print / PDF
      </a>
    </form>
  );
}
