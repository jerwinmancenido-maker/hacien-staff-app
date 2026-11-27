"use client";

import { useEffect, useRef, useState } from "react";
import { formatPeso } from "@/lib/format";

/**
 * FEEL PROTOTYPE — counts a peso value up from 0 on mount (~0.9s, ease-out).
 * Under prefers-reduced-motion the final value renders immediately.
 */
export function CountUp({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      return;
    }
    const dur = 700;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(p >= 1 ? value : Math.round(value * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <>{formatPeso(display)}</>;
}
