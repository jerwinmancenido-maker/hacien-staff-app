import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  soDeliveryOverviewLabel,
  soDeliveryProgress,
  soHasRemainingToDeliver,
} from "@/lib/sales-orders/delivery";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("SL-02 still to deliver helpers", () => {
  it("soHasRemainingToDeliver: partly delivered shows; fully delivered hides; zero remaining hides", () => {
    expect(
      soHasRemainingToDeliver([
        { qty: "10.00", deliveredQty: "4.00" },
        { qty: "5.00", deliveredQty: "5.00" },
      ]),
    ).toBe(true);

    expect(
      soHasRemainingToDeliver([
        { qty: "10.00", deliveredQty: "10.00" },
        { qty: "5.00", deliveredQty: "5.00" },
      ]),
    ).toBe(false);

    expect(soHasRemainingToDeliver([{ qty: "0.00", deliveredQty: "0.00" }])).toBe(false);
    expect(soHasRemainingToDeliver([])).toBe(false);
  });

  it("soDeliveryOverviewLabel uses soDeliveryProgress counts", () => {
    const partial = soDeliveryProgress([
      { qty: "10.00", deliveredQty: "10.00" },
      { qty: "5.00", deliveredQty: "5.00" },
      { qty: "8.00", deliveredQty: "4.00" },
      { qty: "2.00", deliveredQty: "0.00" },
      { qty: "1.00", deliveredQty: "0.00" },
    ]);
    expect(soDeliveryOverviewLabel(partial)).toBe("2 of 5 lines delivered · 3 left to deliver");

    const done = soDeliveryProgress([
      { qty: "10.00", deliveredQty: "10.00" },
      { qty: "5.00", deliveredQty: "5.00" },
    ]);
    expect(soDeliveryOverviewLabel(done)).toBe("Fully delivered");
  });

  it("list page exposes Still to deliver between Still to bill and status chips", () => {
    const src = read("src/app/(app)/sales-orders/page.tsx");
    expect(src).toContain('toDeliver: "1"');
    expect(src).toContain("Still to deliver");
    const bill = src.indexOf("Still to bill");
    const deliver = src.indexOf("Still to deliver");
    const statuses = src.indexOf("SALES_ORDER_STATUSES.map");
    expect(bill).toBeGreaterThan(-1);
    expect(deliver).toBeGreaterThan(bill);
    expect(statuses).toBeGreaterThan(deliver);
  });

  it("overview line uses soDeliveryOverviewLabel, not receipt count", () => {
    const src = read("src/app/(app)/sales-orders/[id]/page.tsx");
    expect(src).toContain("soDeliveryOverviewLabel");
    expect(src).toContain("soDeliveryProgress");
    expect(src).not.toMatch(/Deliveries:\s*\{deliveries\.length\}/);
  });
});

