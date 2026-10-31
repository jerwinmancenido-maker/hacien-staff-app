// Fixtures for the database suites. Every run makes its own users, customer,
// supplier and uses its own random years, so suites can share one test
// database without cleaning it (nothing is ever deleted).

import { randomBytes } from "node:crypto";
import { Prisma, type WithholdingType } from "@prisma/client";
import { db } from "@/lib/db";
import type { DocActor } from "@/lib/services/quotes";
import type { QuoteInput } from "@/lib/validation/quotes";

export const tag = () => randomBytes(4).toString("hex");

const taken = new Set<number>();

const FRESH_YEAR_RANGES: Array<[number, number]> = [
  [2027, 2199],
  [2200, 9998],
];

async function occupiedYears(lo: number, hi: number): Promise<Set<number>> {
  const rows = await db.documentSeries.findMany({
    where: { year: { gte: lo, lte: hi } },
    select: { year: true },
    distinct: ["year"],
  });
  return new Set(rows.map((r) => r.year));
}

/** True when docs or invoice dates already touch this calendar year. */
async function yearHasDocuments(year: number): Promise<boolean> {
  const needle = `-${year}-`;
  const dayStart = new Date(Date.UTC(year, 0, 1));
  const nextDayStart = new Date(Date.UTC(year + 1, 0, 1));
  const [q, so, blByNumber, blByDate] = await Promise.all([
    db.quote.count({ where: { number: { contains: needle } } }),
    db.salesOrder.count({ where: { number: { contains: needle } } }),
    db.billing.count({ where: { number: { contains: needle } } }),
    // Gross-sales tests key off invoiceDate, not doc number year.
    db.billing.count({
      where: { invoiceDate: { gte: dayStart, lt: nextDayStart }, status: { not: "VOID" } },
    }),
  ]);
  return q + so + blByNumber + blByDate > 0;
}

/** A year with no number series yet, so its counters start at 0001. */
export async function freshYear(): Promise<number> {
  // Prefer modern/future years so Asia/Manila UTC+8 stays stable (pre-1970 TZDB
  // offsets break PHT boundary tests). Keep years ≤9998 for MySQL DATE.
  // Shared hacien_test is checkerboarded — require only one free year (not a
  // consecutive pair). Scan linearly per range (one distinct-year query) instead
  // of random COUNT loops that hang when the pool is dense.
  for (let round = 0; round < 2; round++) {
    for (const [lo, hi] of FRESH_YEAR_RANGES) {
      const occupied = await occupiedYears(lo, hi);
      for (let y = lo; y <= hi; y++) {
        if (taken.has(y) || occupied.has(y)) continue;
        taken.add(y);
        return y;
      }
    }
    taken.clear();
  }
  throw new Error("freshYear: no free year in 2027–9998");
}

/**
 * Two consecutive calendar years with no non-void billings by invoiceDate.
 * Tax-year boundary tests key off invoice dates, not DocumentSeries emptiness
 * (series may already exist on a checkerboarded shared DB).
 */
export async function freshYearPair(): Promise<{ base: number; next: number }> {
  for (let round = 0; round < 2; round++) {
    for (const [lo, hi] of FRESH_YEAR_RANGES) {
      for (let y = lo; y < hi && y + 1 <= 9998; y++) {
        if (taken.has(y) || taken.has(y + 1)) continue;
        if (await yearHasDocuments(y)) continue;
        if (await yearHasDocuments(y + 1)) continue;
        taken.add(y).add(y + 1);
        return { base: y, next: y + 1 };
      }
    }
    taken.clear();
  }
  throw new Error("freshYearPair: no consecutive billing-free years in 2027–9998");
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
 * `defaultWithholding` is the saved pick copied onto new quotes:
 *   null  = not set (default)
 *   []    = explicit none
 *   [codes] = those rates (they ARE the pick; type is only a label)
 * When type is omitted, infer a label from the codes for convenience.
 */
export async function makeCustomer(defaultWithholding: string[] | null = null, withholdingType?: WithholdingType) {
  const t = tag();
  const inferred: WithholdingType =
    withholdingType ??
    (defaultWithholding == null
      ? "NONE"
      : defaultWithholding.some((c) => c.startsWith("GOV"))
        ? "GOVERNMENT"
        : defaultWithholding.length > 0
          ? "TOP_WITHHOLDING_AGENT"
          : "NONE");
  return db.customer.create({
    data: {
      name: `Test Customer ${t}`,
      withholdingType: inferred,
      address: "Test address",
      defaultWithholding: defaultWithholding === null ? Prisma.DbNull : defaultWithholding,
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
