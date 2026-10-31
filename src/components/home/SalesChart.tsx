"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { formatPeso } from "@/lib/format";
import { formatSalesAxisPeso, type HomeSalesMonth } from "@/lib/home/sales";

/** On-screen label size (matches .small / muted grey elsewhere). */
const LABEL_PX = 12;

/**
 * Plain SVG bar chart for Home Sales. Thin black bars; current month #2563EB.
 * Hover / tap shows the month and full ₱ amount. Narrow viewports use the
 * last 6 months (caller passes the matching slice via `months`).
 *
 * Axis / month labels use an inverse font-size so they stay ~12px on screen
 * even when the viewBox scales up at wide widths.
 */
export function SalesChart({
  months,
  axisTicks,
}: {
  months: HomeSalesMonth[];
  axisTicks: number[];
}) {
  const [active, setActive] = useState<number | null>(null);
  const tipId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  // Font size in viewBox units → LABEL_PX CSS pixels after the SVG scales.
  const [labelFont, setLabelFont] = useState(LABEL_PX);
  const maxTick = Math.max(0, ...axisTicks, ...months.map((m) => Number(m.amount)));
  const chartMax = maxTick > 0 ? maxTick : 1;

  const W = 360;
  const H = 148;
  const padL = 52;
  const padR = 8;
  const padT = 14;
  const padB = 36;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = Math.max(1, months.length);
  const slot = innerW / n;
  const barW = Math.max(3, Math.min(10, slot * 0.45));

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const sync = () => {
      const w = svg.clientWidth;
      const h = svg.clientHeight;
      if (w <= 0 || h <= 0) return;
      // Uniform meet-scale: labels stay ~LABEL_PX CSS pixels after transform.
      const scale = Math.min(w / W, h / H);
      if (scale <= 0) return;
      setLabelFont(LABEL_PX / scale);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);

  const activeMonth = active !== null ? months[active] : null;
  const yearFont = labelFont * 0.9;

  return (
    <div className="home-sales-chart">
      <svg
        ref={svgRef}
        className="home-sales-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Billed sales for the last months"
      >
        {axisTicks.map((t) => {
          const y = padT + innerH * (1 - t / chartMax);
          return (
            <g key={t}>
              <line
                x1={padL}
                x2={W - padR}
                y1={y}
                y2={y}
                className="home-sales-grid"
              />
              <text
                x={padL - 6}
                y={y + labelFont * 0.35}
                textAnchor="end"
                className="home-sales-axis"
                fontSize={labelFont}
              >
                {formatSalesAxisPeso(t)}
              </text>
            </g>
          );
        })}

        {months.map((m, i) => {
          const value = Number(m.amount);
          const h = chartMax > 0 ? (Math.max(0, value) / chartMax) * innerH : 0;
          // Zero months still render a zero-height bar mark (not a gap in the slot).
          const x = padL + slot * i + (slot - barW) / 2;
          const y = padT + innerH - h;
          const labelY = H - (m.yearLabel ? 14 : 10);
          const isActive = active === i;
          return (
            <g key={m.key}>
              <rect
                x={x}
                y={h > 0 ? y : padT + innerH - 1}
                width={barW}
                height={h > 0 ? h : 1}
                rx={1}
                className={`home-sales-bar${m.isCurrent ? " is-current" : ""}${isActive ? " is-active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                onClick={() => setActive((cur) => (cur === i ? null : i))}
                tabIndex={0}
                role="button"
                aria-label={`${m.shortLabel}${m.yearLabel ? ` ${m.yearLabel}` : ""}: ${formatPeso(m.amount)}`}
                aria-describedby={isActive ? tipId : undefined}
              />
              <text
                x={padL + slot * i + slot / 2}
                y={labelY}
                textAnchor="middle"
                className="home-sales-xlabel"
                fontSize={labelFont}
              >
                {m.shortLabel}
              </text>
              {m.yearLabel ? (
                <text
                  x={padL + slot * i + slot / 2}
                  y={labelY + yearFont + 1}
                  textAnchor="middle"
                  className="home-sales-xyear"
                  fontSize={yearFont}
                >
                  {m.yearLabel}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {activeMonth ? (
        <div id={tipId} className="home-sales-tip" role="status">
          <span className="home-sales-tip-month">
            {activeMonth.shortLabel}
            {activeMonth.yearLabel ? ` ${activeMonth.yearLabel}` : ""}
          </span>
          <span className="home-sales-tip-amount num">{formatPeso(activeMonth.amount)}</span>
        </div>
      ) : (
        <div className="home-sales-tip home-sales-tip-placeholder" aria-hidden="true">
          <span>&nbsp;</span>
        </div>
      )}
    </div>
  );
}
