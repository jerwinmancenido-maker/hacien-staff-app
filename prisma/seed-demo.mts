// Staging demo data seed: fake customers, suppliers, quotes, sales orders, and demo users.
// Strictly for staging only. Runs ONLY when SEED_DEMO_STAGING=1.

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { noDeleteExtension } from "../src/lib/no-delete.ts";
import { demoSeedGuard } from "../src/lib/seed-guard.ts";
import { seedBase } from "../src/lib/seed-base.ts";
import { manilaToday } from "../src/lib/format.ts";
import { formatAddress } from "../src/lib/addresses/format.ts";
import { docTotals, lineAmounts, withholdingSnapshotFromLines } from "../src/lib/quotes/calc.ts";
import {
  lineWithholdingSnapshotFromPicks,
  parseWithholdingPick,
} from "../src/lib/quotes/withholding-defaults.ts";
import { allocateDocNumber, ensureSeries, type NumberFormat } from "../src/lib/documents/series.ts";
import {
  addressData,
  contactData,
  snapshotsFromCodes,
  CUSTOMERS,
  SUPPLIERS,
  DEMO_USERS,
  SAMPLE_NOTE,
  type SeedLine,
} from "../src/lib/seed-demo-helpers.ts";

export function connect() {
  return new PrismaClient().$extends(noDeleteExtension);
}

type SeedClient = ReturnType<typeof connect>;

/** Two sample quotes: a Draft for TESDA (goods + services), and a Won quote for Sample Corp with its sales order. */
async function seedQuotes(db: SeedClient) {
  if (await db.quote.findFirst({ where: { notes: SAMPLE_NOTE } })) return;
  const author = await db.user.findUnique({ where: { email: "jerwin@example.com" } });
  const tesda = await db.customer.findFirst({ where: { name: "TESDA Regional Office" }, include: { contacts: true } });
  const sampleCorp = await db.customer.findFirst({ where: { name: "Sample Corp" }, include: { contacts: true } });
  if (!author || !tesda || !sampleCorp) return;

  const version = await db.settingsVersion.findFirst({ orderBy: { version: "desc" } });
  if (!version) return;
  const settings = version.data as unknown as {
    quotes: { defaultValidityDays: number };
    numbering: { quote: NumberFormat; salesOrder: NumberFormat };
  };
  const suppliers = await db.supplier.findMany();
  const supplierId = (name: string | null) => (name ? (suppliers.find((s) => s.name === name)?.id ?? null) : null);

  const today = manilaToday();
  const year = today.getUTCFullYear();
  const validUntil = new Date(today.getTime() + settings.quotes.defaultValidityDays * 86_400_000);

  async function makeQuote(customer: NonNullable<typeof tesda>, codes: string[], lines: SeedLine[], status: "DRAFT" | "WON") {
    // Prefer the customer's saved pick; fall back to the example codes passed in.
    const pick = parseWithholdingPick(customer.defaultWithholding) ?? codes;
    const picks = snapshotsFromCodes(pick);
    const items = lines.map((l, i) => {
      const wh = lineWithholdingSnapshotFromPicks(picks, l.kind);
      return {
        sortOrder: i + 1,
        description: l.description,
        kind: l.kind,
        qty: l.qty,
        unit: l.unit,
        supplierId: supplierId(l.supplier),
        supplierUnitCost: l.supplierUnitCost,
        unitPrice: l.unitPrice,
        ...lineAmounts(l),
        withholdingRate: wh.withholdingRate,
        withholdingAtc: wh.withholdingAtc,
        withholdingOverride: wh.withholdingOverride,
      };
    });
    const withholding = withholdingSnapshotFromLines(items);
    const t = docTotals(items);
    const totals = {
      contractPrice: t.contractPrice,
      withholdingTotal: t.withholdingTotal,
      netReceived: t.netReceived,
      supplierCost: t.supplierCost,
      netMargin: t.netMargin,
      netMarginPct: t.netMarginPct,
    };
    await ensureSeries(db, "QUOTE", year, settings.numbering.quote);
    return db.$transaction(async (tx) => {
      const number = await allocateDocNumber(tx, "QUOTE", year, settings.numbering.quote);
      const quote = await tx.quote.create({
        data: {
          number,
          customerId: customer.id,
          contactId: customer.contacts.find((c) => c.isMain && c.active)?.id ?? null,
          date: today,
          validUntil,
          status,
          // WON seed quotes are grandfathered APPROVED with null approver (no invented history).
          ...(status === "WON"
            ? { approvalStatus: "APPROVED" as const, approvedById: null, approvedAt: null }
            : { approvalStatus: "PENDING" as const }),
          terms: customer.defaultTerms,
          notes: SAMPLE_NOTE,
          settingsVersionId: version!.id,
          withholding,
          withholdingPick: pick,
          ...totals,
          createdById: author!.id,
          updatedById: author!.id,
          items: { create: items },
        },
        include: { items: true },
      });
      await tx.auditLog.create({ data: { userId: author!.id, entityType: "Quote", entityId: quote.id, action: "create", after: { number, status, sample: true } } });
      return quote;
    });
  }

  await makeQuote(
    tesda,
    ["GOV_GOODS_1"],
    [
      { description: "Laptop, Core i5, 16GB RAM, 512GB SSD", kind: "GOODS", qty: "10", unit: "pc", supplier: "UNO Computer Supply", supplierUnitCost: "45000", unitPrice: "52000" },
      { description: "Installation, imaging and setup", kind: "SERVICES", qty: "1", unit: "lot", supplier: null, supplierUnitCost: "0", unitPrice: "15000" },
    ],
    "DRAFT",
  );

  const won = await makeQuote(
    sampleCorp,
    ["GOODS_1"],
    [
      { description: "24-port gigabit network switch", kind: "GOODS", qty: "4", unit: "pc", supplier: "Metro IT Parts", supplierUnitCost: "12000", unitPrice: "15500" },
      { description: "Cat6 patch cable, 2m", kind: "GOODS", qty: "50", unit: "pc", supplier: "Metro IT Parts", supplierUnitCost: "95", unitPrice: "150" },
    ],
    "WON",
  );

  await ensureSeries(db, "SALES_ORDER", year, settings.numbering.salesOrder);
  await db.$transaction(async (tx) => {
    const number = await allocateDocNumber(tx, "SALES_ORDER", year, settings.numbering.salesOrder);
    const so = await tx.salesOrder.create({
      data: {
        number,
        quoteId: won.id,
        customerId: won.customerId,
        contactId: won.contactId,
        date: today,
        status: "OPEN",
        buyerPoNo: "SC-PO-2026-0042",
        buyerPoDate: today,
        deliveryAddress: formatAddress(CUSTOMERS[1]!.addresses.find((a) => a.kind === "DELIVERY")!, { multiline: true }),
        terms: won.terms,
        notes: won.notes,
        settingsVersionId: won.settingsVersionId,
        withholding: won.withholding ?? [],
        contractPrice: won.contractPrice,
        withholdingTotal: won.withholdingTotal,
        netReceived: won.netReceived,
        supplierCost: won.supplierCost,
        netMargin: won.netMargin,
        netMarginPct: won.netMarginPct,
        createdById: author!.id,
        updatedById: author!.id,
        items: {
          create: won.items.map((i) => ({
            sortOrder: i.sortOrder,
            description: i.description,
            kind: i.kind,
            qty: i.qty,
            unit: i.unit,
            supplierId: i.supplierId,
            supplierUnitCost: i.supplierUnitCost,
            unitPrice: i.unitPrice,
            total: i.total,
            supplierTotal: i.supplierTotal,
            margin: i.margin,
            withholdingRate: i.withholdingRate,
            withholdingAtc: i.withholdingAtc,
            withholdingOverride: i.withholdingOverride,
          })),
        },
      },
    });
    await tx.auditLog.create({ data: { userId: author!.id, entityType: "SalesOrder", entityId: so.id, action: "create", after: { number, fromQuote: won.number, sample: true } } });
  });
  console.log("Sample quotes: created a draft quote and a won quote with its sales order.");
}

/**
 * Runs the demo seed: creates demo users, sample customers, sample suppliers,
 * and demo quotes/sales orders.
 */
export async function seedDemo(db: SeedClient) {
  // Ensure base seed defaults exist first
  await seedBase(db);

  const created: string[] = [];
  for (const u of DEMO_USERS) {
    const existing = await db.user.findUnique({ where: { email: u.email } });
    if (existing) continue;
    const password = process.env.SEED_PASSWORD || randomBytes(24).toString("base64url");
    await db.user.create({
      data: {
        email: u.email,
        name: u.name,
        isAdmin: !!u.isAdmin,
        isApprover: !!u.isApprover,
        isStaff: !!u.isStaff,
        isViewer: !!u.isViewer,
        canSeeCosts: u.canSeeCosts,
        passwordHash: await bcrypt.hash(password, 12),
      },
    });
    created.push(u.email);
  }

  for (const c of CUSTOMERS) {
    const existing = await db.customer.findFirst({ where: { name: c.name } });
    if (existing) {
      if (existing.defaultWithholding === null) {
        await db.customer.update({ where: { id: existing.id }, data: { defaultWithholding: c.defaultWithholding } });
      }
      if (!(await db.address.findFirst({ where: { customerId: existing.id, needsReview: false } }))) {
        await db.address.createMany({ data: addressData(c.addresses).map((a) => ({ ...a, customerId: existing.id })) });
        await db.address.updateMany({ where: { customerId: existing.id, needsReview: true }, data: { archivedAt: new Date(), isDefault: false } });
      }
      continue;
    }
    const { contacts, addresses, ...data } = c;
    await db.customer.create({ data: { ...data, contacts: { create: contacts.map(contactData) }, addresses: { create: addressData(addresses) } } });
  }

  for (const s of SUPPLIERS) {
    const existing = await db.supplier.findFirst({ where: { name: s.name } });
    if (existing) {
      if (!(await db.address.findFirst({ where: { supplierId: existing.id, needsReview: false } }))) {
        await db.address.createMany({ data: addressData(s.addresses).map((a) => ({ ...a, supplierId: existing.id })) });
        await db.address.updateMany({ where: { supplierId: existing.id, needsReview: true }, data: { archivedAt: new Date(), isDefault: false } });
      }
      continue;
    }
    const { contacts, bank, addresses, ...data } = s;
    await db.supplier.create({ data: { ...data, ...bank, contacts: { create: contacts.map(contactData) }, addresses: { create: addressData(addresses) } } });
  }

  await seedQuotes(db);

  if (created.length) {
    const how = process.env.SEED_PASSWORD ? "the password in SEED_PASSWORD" : 'a random password (use "Forgot password" to set one)';
    console.log(`Demo sample users (${created.join(", ")}) were created with ${how}.`);
  }
}

// When run directly as a script:
const isDirectRun = process.argv[1]?.includes("seed-demo");
if (isDirectRun) {
  const refusal = demoSeedGuard(process.env);
  if (refusal) {
    console.error(refusal);
    process.exitCode = 1;
  } else {
    const db = connect();
    seedDemo(db)
      .catch((e) => {
        console.error(e);
        process.exitCode = 1;
      })
      .finally(() => db.$disconnect());
  }
}
