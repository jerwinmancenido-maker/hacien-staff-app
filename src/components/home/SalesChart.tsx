"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatPesoWhole } from "@/lib/format";
import { formatSalesAxisPeso, type HomeSalesMonth } from "@/lib/home/sales";

/** Left gutter for axis labels on screen (px); tight when axis is hidden. */
const PAD_L_PX = 52;
const PAD_L_EMPTY_PX = 10;
const PAD_T_PX = 8;
const PAD_R_PX = 18;
const PAD_B_PX = 0;
/** Fixed viewBox height; width expands so the chart fills the row. */
const VB_H = 220;

function buildSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const p = points[0]!;
    return `M${p.x},${p.y}`;
  }
  let d = `M${points[0]!.x},${points[0]!.y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i]!;
    const p1 = points[i + 1]!;
    const mx = (p0.x + p1.x) / 2;
    d += ` C${mx},${p0.y} ${mx},${p1.y} ${p1.x},${p1.y}`;
  }
  return d;
}

/**
 * Plain SVG line + soft blue area chart for Home Sales.
 * Current month: filled dot, dashed vertical, dark tip with amount.
 * Empty: flat baseline, no ₱ axis.
 */
export function SalesChart({
  months,
  axisTicks,
  empty = false,
}: {
  months: HomeSalesMonth[];
  axisTicks: number[];
  empty?: boolean;
  /** @deprecated alternate month labels are CSS; kept for call-site compat. */
  narrow?: boolean;
}) {
  const tipId = useId();
  const gradId = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const [vbW, setVbW] = useState(760);
  const [scale, setScale] = useState(1);

  const showAxis = !empty && axisTicks.length > 0;
  const chartMax = showAxis ? Math.max(0, ...axisTicks) : 1;
  const safeMax = chartMax > 0 ? chartMax : 1;

  const padL = (showAxis ? PAD_L_PX : PAD_L_EMPTY_PX) / scale;
  const padR = PAD_R_PX / scale;
  const padT = PAD_T_PX / scale;
  const padB = PAD_B_PX / scale;
  const innerW = Math.max(1, vbW - padL - padR);
  const innerH = Math.max(1, VB_H - padT - padB);
  const n = Math.max(1, months.length);
  const slot = innerW / Math.max(1, n - 1 || 1);

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const sync = () => {
      const w = svg.clientWidth;
      const h = svg.clientHeight;
      if (w <= 0 || h <= 0) return;
      setVbW(VB_H * (w / h));
      setScale(h / VB_H);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);

  const points = useMemo(() => {
    return months.map((m, i) => {
      const value = Number(m.amount);
      const x = n === 1 ? padL + innerW / 2 : padL + slot * i;
      const y = empty
        ? padT + innerH
        : padT + innerH * (1 - Math.max(0, value) / safeMax);
      return { x, y, value, month: m, i };
    });
  }, [months, n, padL, padT, innerW, innerH, slot, empty, safeMax]);

  const linePath = buildSmoothPath(points.map((p) => ({ x: p.x, y: p.y })));
  const areaPath =
    points.length > 0
      ? `${linePath} L${points[points.length - 1]!.x},${padT + innerH} L${points[0]!.x},${padT + innerH} Z`
      : "";

  const current = points.find((p) => p.month.isCurrent) ?? points[points.length - 1] ?? null;

  // Deduplicate while keeping top→bottom order for the left axis.
  const axisLabels = showAxis
    ? Array.from(new Set([safeMax, ...[...axisTicks].reverse(), 0]))
    : [];

  return (
    <div className={`home-sales-chart${empty ? " is-empty" : ""}`}>
      {showAxis ? (
        <div className="home-sales-yl" aria-hidden="true">
          {axisLabels.map((t) => (
            <span key={t}>{formatSalesAxisPeso(t)}</span>
          ))}
        </div>
      ) : null}
      <div className="home-sales-chw">
        <svg
          ref={svgRef}
          className="home-sales-svg"
          viewBox={`0 0 ${vbW} ${VB_H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Billed sales for the last 12 months"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#2563EB" stopOpacity="0.28" />
              <stop offset="1" stopColor="#2563EB" stopOpacity="0" />
            </linearGradient>
          </defs>

          {showAxis
            ? axisLabels.map((t) => {
                const y = padT + innerH * (1 - t / safeMax);
                return (
                  <line
                    key={`g-${t}`}
                    x1={0}
                    x2={vbW}
                    y1={y}
                    y2={y}
                    className="home-sales-grid"
                  />
                );
              })
            : (
              <line
                x1={0}
                x2={vbW}
                y1={padT + innerH}
                y2={padT + innerH}
                className="home-sales-grid"
              />
            )}

          {!empty && areaPath ? <path d={areaPath} fill={`url(#${gradId})`} /> : null}
          {linePath ? (
            <path
              d={linePath}
              fill="none"
              className="home-sales-line"
              strokeWidth={2.5 / scale}
            />
          ) : null}

          {!empty
            ? points.map((p) =>
                p.month.isCurrent ? null : (
                  <circle
                    key={p.month.key}
                    cx={p.x}
                    cy={p.y}
                    r={3 / scale}
                    className="home-sales-dot"
                  />
                ),
              )
            : null}

          {!empty && current ? (
            <>
              <line
                x1={current.x}
                x2={current.x}
                y1={current.y}
                y2={padT + innerH}
                className="home-sales-current-guide"
              />
              <circle cx={current.x} cy={current.y} r={7 / scale} className="home-sales-current-halo" />
              <circle cx={current.x} cy={current.y} r={4.5 / scale} className="home-sales-current-dot" />
            </>
          ) : null}
        </svg>

        {!empty && current && current.value > 0 ? (
          <div id={tipId} className="home-sales-tip" role="status">
            <span>
              {current.month.shortLabel} {current.month.key.slice(0, 4)}
            </span>
            <b className="num">{formatPesoWhole(current.month.amount)}</b>
          </div>
        ) : null}
      </div>

      <div className="home-sales-ml" aria-hidden="true">
        {months.map((m) => (
          <span key={m.key} className={m.isCurrent ? "on" : undefined}>
            {m.shortLabel}
          </span>
        ))}
      </div>
    </div>
  );
}
