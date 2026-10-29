"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export type PillTabItem = {
  key: string;
  label: ReactNode;
  count?: number;
  dot?: "red" | "amber" | "green";
  href?: string;
  disabled?: boolean;
};

export type PillTabsProps = {
  tabs: PillTabItem[];
  active: string;
  onChange?: (key: string) => void;
  ariaLabel?: string;
  size?: "default" | "sm";
  className?: string;
};

export function PillTabs({
  tabs,
  active,
  onChange,
  ariaLabel = "Tabs",
  size = "default",
  className = "",
}: PillTabsProps) {
  const router = useRouter();
  const trackRef = useRef<HTMLDivElement>(null);

  // Scroll active tab into view if needed
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const activeEl = track.querySelector(`[data-tab-key="${active}"]`) as HTMLElement | null;
    if (activeEl) {
      const trackRect = track.getBoundingClientRect();
      const elRect = activeEl.getBoundingClientRect();
      if (elRect.left < trackRect.left || elRect.right > trackRect.right) {
        activeEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      }
    }
  }, [active]);

  function handleKeyDown(e: KeyboardEvent, currentKey: string) {
    const keys = tabs.filter((t) => !t.disabled).map((t) => t.key);
    const currentIndex = keys.indexOf(currentKey);
    if (currentIndex === -1) return;

    let targetKey: string | undefined = undefined;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      targetKey = keys[(currentIndex + 1) % keys.length];
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      targetKey = keys[(currentIndex - 1 + keys.length) % keys.length];
    } else if (e.key === "Home") {
      e.preventDefault();
      targetKey = keys[0];
    } else if (e.key === "End") {
      e.preventDefault();
      targetKey = keys[keys.length - 1];
    }

    if (targetKey) {
      const targetTab = tabs.find((t) => t.key === targetKey);
      const targetEl = trackRef.current?.querySelector(`[data-tab-key="${targetKey}"]`) as HTMLElement | null;
      targetEl?.focus();

      if (onChange) {
        onChange(targetKey);
      } else if (targetTab?.href) {
        router.push(targetTab.href);
      }
    }
  }

  return (
    <div className={`pill-tabs-wrap ${className}`}>
      <div
        ref={trackRef}
        role="tablist"
        aria-label={ariaLabel}
        className={`pill-tabs-track ${size === "sm" ? "track-sm" : ""}`}
      >
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          const content = (
            <>
              <span className="pill-tab-label">{tab.label}</span>
              {tab.count !== undefined && (
                <span className={`pill-tab-count${isActive ? " active" : ""}`}>{tab.count}</span>
              )}
              {tab.dot && <span className={`pill-tab-dot dot-${tab.dot}`} aria-hidden />}
            </>
          );

          if (tab.href) {
            return (
              <Link
                key={tab.key}
                href={tab.href}
                role="tab"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                data-tab-key={tab.key}
                className={`pill-tab${isActive ? " active" : ""}${tab.disabled ? " disabled" : ""}`}
                onClick={(e) => {
                  if (tab.disabled) {
                    e.preventDefault();
                    return;
                  }
                  if (onChange) {
                    onChange(tab.key);
                  }
                }}
                onKeyDown={(e) => handleKeyDown(e, tab.key)}
              >
                {content}
              </Link>
            );
          }

          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              data-tab-key={tab.key}
              disabled={tab.disabled}
              className={`pill-tab${isActive ? " active" : ""}`}
              onClick={() => onChange?.(tab.key)}
              onKeyDown={(e) => handleKeyDown(e, tab.key)}
            >
              {content}
            </button>
          );
        })}
      </div>
    </div>
  );
}
