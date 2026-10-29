"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { DotsHorizontalIcon } from "./Icons";

export type RowMenuItem = {
  label: ReactNode;
  danger?: boolean;
  onClick?: (e: MouseEvent) => void;
  href?: string;
  disabled?: boolean;
};

export function RowMenu({
  items,
  ariaLabel = "Row actions",
}: {
  items: RowMenuItem[];
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: globalThis.MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!items || items.length === 0) return null;

  function toggle(e: MouseEvent | KeyboardEvent) {
    e.stopPropagation();
    e.preventDefault();
    setOpen((prev) => !prev);
  }

  return (
    <div className="row-menu" ref={ref} data-no-row-click>
      <button
        type="button"
        className="row-menu-btn"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <DotsHorizontalIcon size={16} />
      </button>
      {open && (
        <div className="row-menu-dropdown" role="menu" tabIndex={-1}>
          {items.map((item, idx) => {
            const className = `row-menu-item${item.danger ? " danger" : ""}`;
            if (item.href) {
              return (
                <Link
                  key={idx}
                  href={item.href}
                  className={className}
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    if (item.onClick) item.onClick(e);
                  }}
                >
                  {item.label}
                </Link>
              );
            }
            return (
              <button
                key={idx}
                type="button"
                className={className}
                role="menuitem"
                disabled={item.disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setOpen(false);
                  if (item.onClick) item.onClick(e);
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
