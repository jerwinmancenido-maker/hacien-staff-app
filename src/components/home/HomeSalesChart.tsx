"use client";

import { useSyncExternalStore } from "react";
import { SalesChart } from "@/components/home/SalesChart";
import { salesAxisTicks, salesChartAxisTicks, type HomeSales } from "@/lib/home/sales";

function subscribeNarrow(onStoreChange: () => void) {
  const mq = window.matchMedia("(max-width: 640px)");
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function getNarrowSnapshot() {
  return window.matchMedia("(max-width: 640px)").matches;
}

function getServerNarrowSnapshot() {
  return false;
}

/** Picks 12 months on wide screens and the last 6 at ≤640px so 360 never side-scrolls. */
export function HomeSalesChart({ sales }: { sales: HomeSales }) {
  const narrow = useSyncExternalStore(subscribeNarrow, getNarrowSnapshot, getServerNarrowSnapshot);

  const months = narrow ? sales.monthsNarrow : sales.months;
  const max = Math.max(0, ...months.map((m) => Number(m.amount)));
  const rawTicks = narrow ? salesAxisTicks(max) : sales.axisTicks;
  const axisTicks = salesChartAxisTicks(sales.empty, rawTicks);
  const windowKey = `${months.map((m) => m.key).join(",")}:${sales.empty ? "e" : "f"}`;

  return (
    <SalesChart
      key={windowKey}
      months={months}
      axisTicks={axisTicks}
      empty={sales.empty}
      narrow={narrow}
    />
  );
}
