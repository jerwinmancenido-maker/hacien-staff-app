"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { formatPeso } from "@/lib/format";
import { formatSalesAxisPeso, type HomeSalesMonth } from "@/lib/home/sales";

/** On-screen label size (matches .small / muted grey elsewhere). */
const LABEL_PX = 12;
/** Bar thickness on screen (px): reads as bars, not hairlines. */
const BAR_PX_WIDE = 14;
const BAR_PX_NARROW = 11;
/** Left gutter for axis labels on screen (px); tight when axis is hidden. */
const PAD_L_PX = 52;
const PAD_L_EMPTY_PX = 8;
/** Top gutter so the current-month amount label never clips (px). */
const PAD_T_PX = 20;
const PAD_R_PX = 8;
const PAD_B_PX = 36;
/** Fixed viewBox height; width expands so the chart fills the row. */
const VB_H = 160;

/**
 * Plain SVG bar chart for Home Sales. Current month #2563EB; others #111.
 * Hover / tap shows the month and full ₱ amount. Narrow viewports use the
 * last 6 months (caller passes the matching slice via `months`).
 *
 * ViewBox width tracks the container aspect so the chart spans the full row at
 * 1280. Axis / month labels stay ~12px on screen. Empty charts omit Y-axis
 * amount labels and gridlines.
 */
export function SalesChart({
  months,
  axisTicks,
  empty = false,
  narrow = false,
}: {
  months: HomeSalesMonth[];
  axisTicks: number[];
  empty?: boolean;
  narrow?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const tipId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [vbW, setVbW] = useState(360);
  const [scale, setScale] = useState(1);

  const showAxis = !empty && axisTicks.length > 0;
  const chartMax = showAxis ? Math.max(0, ...axisTicks) : 1;
  const safeMax = chartMax > 0 ? chartMax : 1;

  const labelFont = LABEL_PX / scale;
  const yearFont = labelFont * 0.9;
  const padL = (showAxis ? PAD_L_PX : PAD_L_EMPTY_PX) / scale;
  const padR = PAD_R_PX / scale;
  const padT = PAD_T_PX / scale;
  const padB = PAD_B_PX / scale;
  const innerW = Math.max(1, vbW - padL - padR);
  const innerH = Math.max(1, VB_H - padT - padB);
  const n = Math.max(1, months.length);
  const slot = innerW / n;
  const barPx = narrow ? BAR_PX_NARROW : BAR_PX_WIDE;
  const barW = Math.min(slot * 0.55, barPx / scale);

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const sync = () => {
      const w = svg.clientWidth;
      const h = svg.clientHeight;
      if (w <= 0 || h <= 0) return;
      // Match viewBox aspect to the laid-out box so meet fills the full width
      // (no centred half-width chart under the height cap).
      setVbW(VB_H * (w / h));
      setScale(h / VB_H);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);

  const activeMonth = active !== null ? months[active] : null;

  return (
    <div className={`home-sales-chart${empty ? " is-empty" : ""}`}>
      <svg
        ref={svgRef}
        className="home-sales-svg"
        viewBox={`0 0 ${vbW} ${VB_H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Billed sales for the last months"
      >
        {showAxis
          ? axisTicks.map((t) => {
              const y = padT + innerH * (1 - t / safeMax);
              return (
                <g key={t}>
                  <line
                    x1={padL}
                    x2={vbW - padR}
                    y1={y}
                    y2={y}
                    className="home-sales-grid"
                  />
                  <text
                    x={padL - 6 / scale}
                    y={y + labelFont * 0.35}
                    textAnchor="end"
                    className="home-sales-axis"
                    fontSize={labelFont}
                  >
                    {formatSalesAxisPeso(t)}
                  </text>
                </g>
              );
            })
          : null}

        {months.map((m, i) => {
          const value = Number(m.amount);
          const h = !empty && safeMax > 0 ? (Math.max(0, value) / safeMax) * innerH : 0;
          const x = padL + slot * i + (slot - barW) / 2;
          const y = padT + innerH - h;
          const cx = padL + slot * i + slot / 2;
          const labelY = VB_H - (m.yearLabel ? padB * 0.35 : padB * 0.28);
          const isActive = active === i;
          const showAmount = !empty && m.isCurrent && value > 0;
          return (
            <g key={m.key}>
              <rect
                x={x}
                y={h > 0 ? y : padT + innerH - 1 / scale}
                width={barW}
                height={h > 0 ? h : 1 / scale}
                rx={1 / scale}
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
              {showAmount ? (
                <text
                  x={cx}
                  y={y - 4 / scale}
                  textAnchor="middle"
                  className="home-sales-bar-amount"
                  fontSize={labelFont}
                >
                  {formatSalesAxisPeso(value)}
                </text>
              ) : null}
              <text
                x={cx}
                y={labelY}
                textAnchor="middle"
                className="home-sales-xlabel"
                fontSize={labelFont}
              >
                {m.shortLabel}
              </text>
              {m.yearLabel ? (
                <text
                  x={cx}
                  y={labelY + yearFont + 1 / scale}
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
