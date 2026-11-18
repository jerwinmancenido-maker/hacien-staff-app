// Regression (2026-11-18): the Settings Audit log crashed on staging
// whenever an audit row pointed at a supplier bill. resolveAuditLabels
// grouped SupplierBill with the models whose label field is `number`,
// but SupplierBill stores its number in `billNumber`, so Prisma threw a
// validation error and the whole tab failed to load. Imports the real
// resolver against the real test DB.

import { beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url, ids: { user: "", supplier: "", bill: "" } };
});

import { db } from "@/lib/db";
import { resolveAuditLabels } from "@/lib/audit-log";

const BILL_NUMBER = "TEST-AUDIT-BILL-20261118";

describe.skipIf(!env.hasDb)("audit label resolution", () => {
  beforeAll(async () => {
    const user = await db.user.create({
      data: { email: `audit-labels-${Date.now()}@example.invalid`, name: "Audit Labels Test" },
    });
    env.ids.user = user.id;
    const supplier = await db.supplier.create({
      data: { name: "Audit Labels Test Supplier", taxType: "VAT" },
    });
    env.ids.supplier = supplier.id;
    const bill = await db.supplierBill.create({
      data: {
        supplierId: supplier.id,
        billNumber: BILL_NUMBER,
        billDate: new Date("2026-11-18"),
        dueDate: new Date("2026-12-18"),
        amount: "2000.00",
        createdById: user.id,
      },
    });
    env.ids.bill = bill.id;
  });

  // No cleanup: the test DB is throwaway (dropped and recreated before
  // every db run), and the app's no-hard-delete guard rightly refuses
  // deleteMany on SupplierBill anyway.

  it("resolves a SupplierBill row to its billNumber without throwing", async () => {
    const labels = await resolveAuditLabels([{ entityType: "SupplierBill", entityId: env.ids.bill }]);
    expect(labels.get(`SupplierBill:${env.ids.bill}`)).toBe(BILL_NUMBER);
  });
});
