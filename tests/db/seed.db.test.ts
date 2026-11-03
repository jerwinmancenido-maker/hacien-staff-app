import { afterAll, describe, expect, it, vi } from "vitest";

const hasDb = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return !!url;
});

import { db } from "@/lib/db";
import { seedBase } from "@/lib/seed-base";

describe.skipIf(!hasDb)("base seed (MySQL)", () => {
  afterAll(async () => {
    await db.$disconnect();
  });

  it("base seed creates no customer, supplier, quote, or sales order rows", async () => {
    const customersBefore = await db.customer.count();
    const suppliersBefore = await db.supplier.count();
    const quotesBefore = await db.quote.count();
    const salesOrdersBefore = await db.salesOrder.count();

    await seedBase(db);

    expect(await db.customer.count()).toBe(customersBefore);
    expect(await db.supplier.count()).toBe(suppliersBefore);
    expect(await db.quote.count()).toBe(quotesBefore);
    expect(await db.salesOrder.count()).toBe(salesOrdersBefore);

    // Settings and withholding rates should exist
    expect(await db.settingsVersion.count()).toBeGreaterThanOrEqual(1);
    expect(await db.withholdingRate.count()).toBeGreaterThan(0);
  });
});
