"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BellIcon } from "./Icons";
import { notificationBadgeTotal, type NotificationSection } from "@/lib/notification-types";

/** S-57: the topbar bell, now real — counts and links, no new page. */
export function NotificationsBell({ sections }: { sections: NotificationSection[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const total = notificationBadgeTotal(sections);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: globalThis.MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open ]);

  return (
    <div className="notif-bell" ref={ref}>
      <button
        type="button"
        className="topbar-icon-btn"
        aria-label={total > 0 ? `${total} notifications` : "Notifications"}
        title="Notifications"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <BellIcon size={16} />
        {total > 0 ? <span className="notif-badge">{total > 99 ? "99+" : total}</span> : null}
      </button>
      {open ? (
        <div className="notif-panel" role="menu">
          {sections.length === 0 ? (
            <p className="faint small" style={{ padding: "8px 12px" }}>
              Nothing needs attention right now.
            </p>
          ) : (
            sections.map((section) => (
              <div key={section.key} className="notif-section">
                <div className="notif-section-head">
                  <span>
                    {section.label} · {section.count}
                  </span>
                  <Link href={section.href} className="btn-link small" onClick={() => setOpen(false)}>
                    See all →
                  </Link>
                </div>
                {section.items.map((item) => (
                  <Link key={item.href} href={item.href} className="notif-item" onClick={() => setOpen(false)}>
                    {item.label}
                  </Link>
                ))}
                {section.count > section.items.length ? (
                  <div className="small faint" style={{ padding: "2px 12px 6px" }}>
                    +{section.count - section.items.length} more
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
