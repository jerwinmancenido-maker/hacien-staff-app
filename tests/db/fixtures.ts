// Fixtures for the database suites. Every run makes its own users, customer,
// supplier and uses its own random years, so suites can share one test
// database without cleaning it (nothing is ever deleted).

import { randomBytes } from "node:crypto";
import type { WithholdingType } from "@prisma/client";
import { db } from "@/lib/db";
import type { DocActor } from "@/lib/services/quotes";
import type { QuoteInput } from "@/lib/validation/quotes";

export const tag = () => randomBytes(4).toString("hex");

const taken = new Set<number>();

/** A year (and the year after it) with no number series yet, so its counters start at 0001. */
export async function freshYear(): Promise<number> {
  for (;;) {
    const y = 2200 + Math.floor(Math.random() * 7000);
    if (taken.has(y) || taken.has(y + 1)) continue;
    const used = await db.documentSeries.count({ where: { year: { in: [y, y + 1] } } });
    if (used) continue;
    taken.add(y).add(y + 1);
    return y;
  }
}

export async function makeUser(kind: "costs" | "staff" | "viewer"): Promise<DocActor> {
  const t = tag();
  return db.user.create({
    data: {
      email: `${kind}-${t}@test.example.com`,
      name: `Test ${kind} ${t}`,
      isAdmin: kind === "costs",
      isApprover: kind === "costs",
      isStaff: kind === "staff",
      isViewer: kind === "viewer",
      canSeeCosts: kind === "costs",
    },
  });
}

/**
 * `defaultWithholding` is legacy (kept on the row). New quotes derive rates from
 * `withholdingType`. When the type is omitted, infer a type that matches the
 * legacy codes so older fixtures still get the rates they expect.
 */
export async function makeCustomer(defaultWithholding: string[] = [], withholdingType?: WithholdingType) {
  const t = tag();
  const inferred: WithholdingType =
    withholdingType ??
    (defaultWithholding.some((c) => c.startsWith("GOV"))
      ? "GOVERNMENT"
      : defaultWithholding.length > 0
        ? "TOP_WITHHOLDING_AGENT"
        : "NONE");
  return db.customer.create({
    data: {
      name: `Test Customer ${t}`,
      withholdingType: inferred,
      address: "Test address",
      defaultWithholding,
      contacts: { create: [{ name: `Buyer ${t}`, email: `buyer-${t}@test.example.com`, isMain: true }] },
    },
    include: { contacts: true },
  });
}

export async function makeSupplier() {
  return db.supplier.create({ data: { name: `Test Supplier ${tag()}`, taxType: "VAT" } });
}

export function quoteInput(customerId: string, year: number, extra: Partial<QuoteInput> = {}, supplierId: string | null = null): QuoteInput {
  return {
    customerId,
    contactId: null,
    date: new Date(Date.UTC(year, 2, 15)),
    validUntil: undefined,
    terms: "Net 30",
    notes: null,
    internalNotes: null,
    subject: null,
    buyerPoNo: null,
    items: [
      { id: null, description: "Laptop i5", kind: "GOODS", qty: "10", unit: "pc", supplierId, supplierUnitCost: "45000", unitPrice: "52000" },
      { id: null, description: "Installation", kind: "SERVICES", qty: "1", unit: "lot", supplierId: null, supplierUnitCost: "5000", unitPrice: "20000" },
    ],
    ...extra,
  };
}
