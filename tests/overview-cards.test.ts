// Supplier overview hides Open quotes / Open SOs; customer overview keeps them.

import { describe, expect, it } from "vitest";
import { openDocCardIds, type OpenDocStats } from "@/components/OverviewCards";

const customerStats: NonNullable<OpenDocStats> = {
  openQuotes: 2,
  openQuotesTotal: "1000.00",
  openSalesOrders: 1,
  openSalesOrdersTotal: "500.00",
};

const supplierStats: NonNullable<OpenDocStats> = {
  openQuotes: 0,
  openQuotesTotal: "0.00",
  openSalesOrders: 0,
  openSalesOrdersTotal: "0.00",
  openPos: 3,
  awaitingReceipt: 1,
};

describe("openDocCardIds", () => {
  it("customer overview shows Open quotes and Open SOs", () => {
    expect(openDocCardIds(customerStats, true)).toEqual(["openQuotes", "openSalesOrders"]);
  });

  it("supplier overview hides Open quotes and Open SOs; keeps Open POs", () => {
    expect(openDocCardIds(supplierStats, false)).toEqual(["openPos"]);
    expect(openDocCardIds(supplierStats, false)).not.toContain("openQuotes");
    expect(openDocCardIds(supplierStats, false)).not.toContain("openSalesOrders");
  });

  it("restricted (null stats) card is customer-only", () => {
    expect(openDocCardIds(null, true)).toEqual(["restricted"]);
    expect(openDocCardIds(null, false)).toEqual([]);
  });
});
