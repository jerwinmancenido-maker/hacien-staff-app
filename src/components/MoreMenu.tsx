"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDownIcon } from "./Icons";

export type MoreMenuItem = {
  label: ReactNode;
  danger?: boolean;
  onClick?: (e: MouseEvent) => void;
  href?: string;
  disabled?: boolean;
};

export function MoreMenu({
  items,
  label = "More",
  primary = false,
}: {
  items: MoreMenuItem[];
  label?: string;
  primary?: boolean;
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

  return (
    <div className="more-menu" ref={ref}>
      <button
        type="button"
        className={`btn ${primary ? "" : "btn-secondary"}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span>{label}</span>
        <ChevronDownIcon size={14} />
      </button>
      {open && (
        <div className="more-menu-dropdown" role="menu">
          {items.map((item, idx) => {
            const className = `more-menu-item${item.danger ? " danger" : ""}`;
            if (item.href) {
              return (
                <Link
                  key={idx}
                  href={item.href}
                  className={className}
                  role="menuitem"
                  onClick={(e) => {
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
