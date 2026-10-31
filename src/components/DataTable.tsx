"use client";

// List table: whole row clickable (mouse or Enter), sticky header, sortable columns.
// Cells are rendered on the server and passed in; sorting uses `sort` values.
// Rows with href include a real <a> so open-in-new-tab / middle-click work.

import { useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export type Column = { key: string; label: string; numeric?: boolean; sortable?: boolean };
export type Row = {
  id: string;
  href?: string;
  inactive?: boolean;
  cells: Record<string, ReactNode>;
  sort?: Record<string, string | number | null>;
};

const INTERACTIVE = "a, button, input, select, textarea, label, [data-no-row-click]";

export function DataTable({ columns, rows, label }: { columns: Column[]; rows: Row[]; label: string }) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [dir, setDir] = useState<1 | -1>(1);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      const av = a.sort?.[sortKey] ?? "";
      const bv = b.sort?.[sortKey] ?? "";
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), "en", { numeric: true, sensitivity: "base" }) * dir;
    });
  }, [rows, sortKey, dir]);

  function toggleSort(key: string) {
    if (sortKey === key) setDir(dir === 1 ? -1 : 1);
    else {
      setSortKey(key);
      setDir(1);
    }
  }

  function open(row: Row, e: MouseEvent | KeyboardEvent) {
    if (!row.href) return;
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    if ("button" in e && e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    router.push(row.href);
  }

  return (
    <div className="table-wrap">
      <table className="list" aria-label={label}>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sortKey === c.key;
              return (
                <th
                  key={c.key}
                  className={c.numeric ? "num" : undefined}
                  aria-sort={active ? (dir === 1 ? "ascending" : "descending") : undefined}
                >
                  {c.sortable === false ? (
                    c.label
                  ) : (
                    <button type="button" onClick={() => toggleSort(c.key)}>
                      {c.label}
                      <span className="sort" aria-hidden>
                        {active ? (dir === 1 ? "↑" : "↓") : ""}
                      </span>
                    </button>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={row.id}
              className={`${row.href ? "clickable row-has-link" : ""}${row.inactive ? " inactive" : ""}`}
              tabIndex={row.href ? 0 : undefined}
              onClick={(e) => open(row, e)}
              onKeyDown={(e) => {
                if (e.key === "Enter") open(row, e);
              }}
            >
              {columns.map((c, i) => (
                <td key={c.key} className={c.numeric ? "num" : undefined}>
                  {i === 0 && row.href ? <a href={row.href} className="row-stretched-link" tabIndex={-1} aria-hidden /> : null}
                  {row.cells[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
