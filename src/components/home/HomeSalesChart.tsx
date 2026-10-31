"use client";

import { SalesChart } from "@/components/home/SalesChart";
import { salesChartAxisTicks, type HomeSales } from "@/lib/home/sales";

/** Always plots the last 12 Manila months; phone CSS hides every other label. */
export function HomeSalesChart({ sales }: { sales: HomeSales }) {
  const axisTicks = salesChartAxisTicks(sales.empty, sales.axisTicks);
  return (
    <SalesChart
      months={sales.months}
      axisTicks={axisTicks}
      empty={sales.empty}
    />
  );
}
