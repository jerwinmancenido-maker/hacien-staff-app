"use client";

import { useMemo, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Avatar, Chip, EmptyState, type ChipTone } from "./ui";
import { CardViewIcon, CompactViewIcon, GridViewIcon } from "./Icons";
import { RowMenu, type RowMenuItem } from "./RowMenu";

export type ViewMode = "a" | "b" | "c";

export type RecordItem = {
  id: string;
  href?: string;
  inactive?: boolean;
  avatarName?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  chips?: Array<{ label: ReactNode; tone?: ChipTone }>;
  meta?: Array<{ label: string; value: ReactNode }>;
  amount?: { label?: string; value: ReactNode; strong?: boolean };
  menuItems?: RowMenuItem[];
  // For sorting
  sortValues?: Record<string, string | number | null | undefined>;
};

export type SortColumn = {
  key: string;
  label: string;
  numeric?: boolean;
};

export type RecordListProps = {
  listKey: string;
  label: string;
  items: RecordItem[];
  emptyTitle?: string;
  emptyLine?: string;
  emptyAction?: ReactNode;
  sortColumns?: SortColumn[];
  defaultSortKey?: string;
  defaultSortDir?: 1 | -1;
  className?: string;
};

const INTERACTIVE = "a, button, input, select, textarea, label, [data-no-row-click]";

function subscribeStorage(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function RowShell({
  item,
  className,
  children,
  onActivate,
}: {
  item: RecordItem;
  className: string;
  children: ReactNode;
  onActivate: (e: MouseEvent | KeyboardEvent) => void;
}) {
  if (!item.href) {
    return (
      <div role="listitem" className={className}>
        {children}
      </div>
    );
  }
  return (
    <div
      role="listitem"
      tabIndex={0}
      className={className}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter") onActivate(e);
      }}
    >
      {/* Real href so middle-click / open-in-new-tab work; interactive controls sit above it. */}
      <a href={item.href} className="row-stretched-link" tabIndex={-1} aria-hidden />
      {children}
    </div>
  );
}

export function RecordList({
  listKey,
  label,
  items,
  emptyTitle = "All clear here",
  emptyLine = "Nothing here yet.",
  emptyAction,
  sortColumns,
  defaultSortKey,
  defaultSortDir = 1,
  className = "",
}: RecordListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // View mode: URL param > local state > localStorage > default "a"
  const urlView = searchParams.get("view")?.toLowerCase();
  const validUrlView = urlView === "a" || urlView === "b" || urlView === "c" ? urlView : null;

  const [localMode, setLocalMode] = useState<ViewMode | null>(null);

  const storedView = useSyncExternalStore(
    subscribeStorage,
    () => {
      try {
        const v = localStorage.getItem(`hacien_view_${listKey}`);
        return v === "a" || v === "b" || v === "c" ? v : null;
      } catch {
        return null;
      }
    },
    () => null
  );

  const viewMode: ViewMode = validUrlView ?? localMode ?? storedView ?? "a";

  const [sortKey, setSortKey] = useState<string | null>(defaultSortKey ?? null);
  const [sortDir, setSortDir] = useState<1 | -1>(defaultSortDir);

  function changeView(mode: ViewMode) {
    setLocalMode(mode);
    try {
      localStorage.setItem(`hacien_view_${listKey}`, mode);
    } catch {
      // ignore
    }
    const params = new URLSearchParams(window.location.search);
    params.set("view", mode);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, "", newUrl);
  }

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(1);
    }
  }

  function handleRowClick(item: RecordItem, e: MouseEvent | KeyboardEvent) {
    if (!item.href) return;
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    // Left-click / Enter: same-tab navigation (stretched <a> still enables open-in-new-tab).
    if ("button" in e && e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    router.push(item.href);
  }

  const sortedItems = useMemo(() => {
    if (!sortKey) return items;
    return [...items].sort((a, b) => {
      const av = a.sortValues?.[sortKey] ?? "";
      const bv = b.sortValues?.[sortKey] ?? "";
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * sortDir;
      return String(av).localeCompare(String(bv), "en", { numeric: true, sensitivity: "base" }) * sortDir;
    });
  }, [items, sortKey, sortDir]);

  return (
    <div className={`record-list-wrap ${className}`} aria-label={label}>
      <div className="record-list-controls">
        {sortColumns && sortColumns.length > 0 ? (
          <div className="record-list-sort">
            <span className="sort-label">Sort:</span>
            {sortColumns.map((col) => {
              const active = sortKey === col.key;
              return (
                <button
                  key={col.key}
                  type="button"
                  className={`sort-chip${active ? " active" : ""}`}
                  onClick={() => toggleSort(col.key)}
                >
                  {col.label}
                  {active && (
                    <span className="sort-arrow" aria-hidden>
                      {sortDir === 1 ? " ↑" : " ↓"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div />
        )}

        <div className="view-switch-segmented" role="radiogroup" aria-label="Choose list view style">
          <button
            type="button"
            role="radio"
            aria-checked={viewMode === "a"}
            className={`view-toggle-btn${viewMode === "a" ? " active" : ""}`}
            onClick={() => changeView("a")}
            title="A: Card rows"
          >
            <CardViewIcon size={14} />
            <span className="view-toggle-text">A Card rows</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={viewMode === "b"}
            className={`view-toggle-btn${viewMode === "b" ? " active" : ""}`}
            onClick={() => changeView("b")}
            title="B: Compact list"
          >
            <CompactViewIcon size={14} />
            <span className="view-toggle-text">B Compact</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={viewMode === "c"}
            className={`view-toggle-btn${viewMode === "c" ? " active" : ""}`}
            onClick={() => changeView("c")}
            title="C: Tile grid"
          >
            <GridViewIcon size={14} />
            <span className="view-toggle-text">C Tile grid</span>
          </button>
        </div>
      </div>

      {sortedItems.length === 0 ? (
        <div className="card">
          <EmptyState title={emptyTitle} line={emptyLine} action={emptyAction} />
        </div>
      ) : (
        <>
          {viewMode === "a" && (
            <div className="record-list-cards" role="list">
              {sortedItems.map((item) => (
                <RowShell
                  key={item.id}
                  item={item}
                  className={`record-card-row${item.href ? " clickable" : ""}${item.inactive ? " inactive" : ""}`}
                  onActivate={(e) => handleRowClick(item, e)}
                >
                  <div className="card-row-avatar">
                    <Avatar name={item.avatarName ?? (typeof item.title === "string" ? item.title : "•")} />
                  </div>
                  <div className="card-row-primary">
                    <div className="card-row-title">{item.title}</div>
                    {item.subtitle && <div className="card-row-sub">{item.subtitle}</div>}
                  </div>
                  {item.chips && item.chips.length > 0 && (
                    <div className="card-row-chips">
                      {item.chips.map((ch, i) => (
                        <Chip key={i} tone={item.inactive ? "grey" : ch.tone}>
                          {ch.label}
                        </Chip>
                      ))}
                    </div>
                  )}
                  {item.amount && (
                    <div className="card-row-amount num">
                      {item.amount.label && <div className="card-row-amount-label">{item.amount.label}</div>}
                      <div className={`card-row-amount-val${item.amount.strong ? " strong" : ""}`}>
                        {item.amount.value}
                      </div>
                    </div>
                  )}
                  {item.menuItems && item.menuItems.length > 0 && (
                    <div className="card-row-menu" data-no-row-click>
                      <RowMenu items={item.menuItems} />
                    </div>
                  )}
                </RowShell>
              ))}
            </div>
          )}

          {viewMode === "b" && (
            <div className="record-compact-wrap">
              <div className="record-compact-list" role="list">
                {sortedItems.map((item) => (
                  <RowShell
                    key={item.id}
                    item={item}
                    className={`record-compact-row${item.href ? " clickable" : ""}${item.inactive ? " inactive" : ""}`}
                    onActivate={(e) => handleRowClick(item, e)}
                  >
                    <div className="compact-avatar">
                      <Avatar name={item.avatarName ?? (typeof item.title === "string" ? item.title : "•")} small />
                    </div>
                    <div className="compact-title-group">
                      <span className="compact-title">{item.title}</span>
                      {item.subtitle && <span className="compact-sub">{item.subtitle}</span>}
                    </div>
                    {item.chips && item.chips.length > 0 && (
                      <div className="compact-chips">
                        {item.chips.map((ch, i) => (
                          <Chip key={i} tone={item.inactive ? "grey" : ch.tone}>
                            {ch.label}
                          </Chip>
                        ))}
                      </div>
                    )}
                    {item.amount && <div className="compact-amount num">{item.amount.value}</div>}
                    {item.menuItems && item.menuItems.length > 0 && (
                      <div className="compact-menu" data-no-row-click>
                        <RowMenu items={item.menuItems} />
                      </div>
                    )}
                  </RowShell>
                ))}
              </div>
            </div>
          )}

          {viewMode === "c" && (
            <div className="record-tile-grid" role="list">
              {sortedItems.map((item) => (
                <RowShell
                  key={item.id}
                  item={item}
                  className={`record-tile-card${item.href ? " clickable" : ""}${item.inactive ? " inactive" : ""}`}
                  onActivate={(e) => handleRowClick(item, e)}
                >
                  <div className="tile-head">
                    <div className="tile-identity">
                      <Avatar name={item.avatarName ?? (typeof item.title === "string" ? item.title : "•")} />
                      <div>
                        <div className="tile-title">{item.title}</div>
                        {item.subtitle && <div className="tile-sub">{item.subtitle}</div>}
                      </div>
                    </div>
                    {item.menuItems && item.menuItems.length > 0 && (
                      <div data-no-row-click>
                        <RowMenu items={item.menuItems} />
                      </div>
                    )}
                  </div>

                  {item.chips && item.chips.length > 0 && (
                    <div className="tile-chips">
                      {item.chips.map((ch, i) => (
                        <Chip key={i} tone={item.inactive ? "grey" : ch.tone}>
                          {ch.label}
                        </Chip>
                      ))}
                    </div>
                  )}

                  {item.meta && item.meta.length > 0 && (
                    <div className="tile-meta">
                      {item.meta.map((m, i) => (
                        <div key={i} className="tile-meta-row">
                          <span className="tile-meta-label">{m.label}:</span>
                          <span className="tile-meta-val">{m.value}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {item.amount && (
                    <div className="tile-foot">
                      {item.amount.label && <span className="tile-foot-label">{item.amount.label}</span>}
                      <span className={`tile-foot-val num${item.amount.strong ? " strong" : ""}`}>
                        {item.amount.value}
                      </span>
                    </div>
                  )}
                </RowShell>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
