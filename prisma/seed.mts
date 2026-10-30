// Sample data: `SEED_SAMPLE=true npm run db:seed`. Safe to run more than once
// (it only adds what's missing and never deletes). All people, TINs and bank
// numbers are fake.
//
// Refuses to run unless SEED_SAMPLE=true, and always refuses when
// NODE_ENV=production, so fake customers can never land in the real books.
// (Settings version 1 is created automatically by the app on first use.)
//
// Passwords: sample users get SEED_PASSWORD if set, otherwise a random one.
// Passwords are never printed — set SEED_PASSWORD or use "Forgot password".

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { noDeleteExtension } from "../src/lib/no-delete.ts";
import { DEFAULT_SETTINGS } from "../src/lib/settings/defaults.ts";
import { seedRefusal } from "../src/lib/seed-guard.ts";
import { manilaToday } from "../src/lib/format.ts";
import { docTotals, lineAmounts, type WithholdingSnapshot } from "../src/lib/quotes/calc.ts";
import { allocateDocNumber, ensureSeries, type NumberFormat } from "../src/lib/documents/series.ts";

type SeedUser = {
  email: string;
  name: string;
  isAdmin?: boolean;
  isApprover?: boolean;
  isStaff?: boolean;
  isViewer?: boolean;
  canSeeCosts: boolean;
};

const USERS: SeedUser[] = [
  { email: "jerwin@example.com", name: "Jerwin", isAdmin: true, isApprover: true, canSeeCosts: true },
  { email: "staff@example.com", name: "Maria Santos", isStaff: true, canSeeCosts: false },
  { email: "viewer@example.com", name: "Paolo Reyes", isViewer: true, canSeeCosts: false },
];

type SeedContact = { name: string; role: string; email?: string; phone?: string; isMain?: boolean; active?: boolean };

const CUSTOMERS: {
  name: string;
  tin: string;
  address: string;
  withholdingType: "GOVERNMENT" | "TOP_WITHHOLDING_AGENT" | "NONE";
  /** Default withholding rate codes copied onto new quotes (examples only). */
  defaultWithholding: string[];
  defaultTerms: string;
  contacts: SeedContact[];
}[] = [
  {
    name: "TESDA Regional Office",
    tin: "000-111-222-000",
    address: "Sample Regional Office, Quezon City, Metro Manila",
    withholdingType: "GOVERNMENT",
    defaultWithholding: ["GOODS_1", "GOV_PT_3"],
    defaultTerms: "Net 30",
    contacts: [
      { name: "Ana Cruz", role: "Procurement", email: "ana.cruz@example.com", phone: "0917 000 0001", isMain: true },
      { name: "Ben Villanueva", role: "End user", email: "ben.v@example.com" },
      { name: "Carla Ramos", role: "Accounting", phone: "02 8000 0003", active: false },
    ],
  },
  {
    name: "Sample Corp",
    tin: "000-333-444-000",
    address: "Sample Tower, Ortigas Center, Pasig City",
    withholdingType: "TOP_WITHHOLDING_AGENT",
    defaultWithholding: ["GOODS_1"],
    defaultTerms: "Net 60",
    contacts: [
      { name: "Dina Lopez", role: "Accounting", email: "dina.lopez@example.com", isMain: true },
      { name: "Eric Tan", role: "Procurement", phone: "0918 000 0005", active: false },
    ],
  },
  {
    name: "Juan Dela Cruz Trading",
    tin: "000-555-666-000",
    address: "Sample St., Makati City",
    withholdingType: "NONE",
    defaultWithholding: [],
    defaultTerms: "COD",
    contacts: [
      { name: "Juan Dela Cruz", role: "Other", phone: "0919 000 0006", isMain: true },
      { name: "Fe Dela Cruz", role: "Accounting", email: "fe.dc@example.com", active: false },
    ],
  },
];

const SUPPLIERS: {
  name: string;
  tin?: string;
  address: string;
  taxType: "VAT" | "NON_VAT" | "NO_RECEIPT";
  defaultTerms: string;
  bank?: { bankAccountName: string; bankAccountNumber: string; bankBranch: string; bankNotes?: string };
  contacts: SeedContact[];
}[] = [
  {
    name: "UNO Computer Supply",
    tin: "000-777-888-000",
    address: "Sample Building, Gilmore Ave., Quezon City",
    taxType: "VAT",
    defaultTerms: "Net 30",
    bank: {
      bankAccountName: "UNO Computer Supply Inc.",
      bankAccountNumber: "0000-0000-0000",
      bankBranch: "UnionBank – Sample Branch",
      bankNotes: "Fake account for testing.",
    },
    contacts: [
      { name: "Gina Uy", role: "Accounting", email: "gina.uy@example.com", isMain: true },
      { name: "Hector Lim", role: "Other", phone: "0920 000 0008" },
      { name: "Ivy Go", role: "Procurement", email: "ivy.go@example.com", active: false },
    ],
  },
  {
    name: "Metro IT Parts",
    tin: "000-999-000-000",
    address: "Sample Mall, Manila",
    taxType: "NON_VAT",
    defaultTerms: "COD",
    contacts: [
      { name: "Jun Mercado", role: "Other", phone: "0921 000 0009", isMain: true },
      { name: "Kim Bautista", role: "Accounting", email: "kim.b@example.com", active: false },
    ],
  },
  {
    name: "Gilmore Street Seller",
    address: "Gilmore Ave., Quezon City",
    taxType: "NO_RECEIPT",
    defaultTerms: "COD",
    contacts: [
      { name: "Leo Garcia", role: "Other", phone: "0922 000 0010", isMain: true },
      { name: "Mia Garcia", role: "Other", phone: "0922 000 0011", active: false },
    ],
  },
];

function contactData(c: SeedContact) {
  const active = c.active ?? true;
  return {
    name: c.name,
    role: c.role,
    email: c.email ?? null,
    phone: c.phone ?? null,
    isMain: !!c.isMain,
    active,
    archivedAt: active ? null : new Date(),
  };
}

async function main(db: ReturnType<typeof connect>) {
  // Settings: version 1 from defaults, only if there is none yet.
  if ((await db.settingsVersion.count()) === 0) {
    await db.settingsVersion.create({ data: { version: 1, data: DEFAULT_SETTINGS } });
    console.log("Settings: created version 1 from defaults.");
  }

  const created: string[] = [];
  for (const u of USERS) {
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

  // Withholding rates normally come from the migration; add any that are missing.
  for (const [i, r] of WITHHOLDING_RATES.entries()) {
    if (await db.withholdingRate.findUnique({ where: { code: r.code } })) continue;
    await db.withholdingRate.create({ data: { ...r, note: "verify with BIR", sortOrder: i + 1 } });
  }

  for (const c of CUSTOMERS) {
    const existing = await db.customer.findFirst({ where: { name: c.name } });
    if (existing) {
      // Customers seeded before Part 2 have no default withholding yet.
      if (existing.defaultWithholding === null) {
        await db.customer.update({ where: { id: existing.id }, data: { defaultWithholding: c.defaultWithholding } });
      }
      continue;
    }
    const { contacts, ...data } = c;
    await db.customer.create({ data: { ...data, contacts: { create: contacts.map(contactData) } } });
  }

  for (const s of SUPPLIERS) {
    if (await db.supplier.findFirst({ where: { name: s.name } })) continue;
    const { contacts, bank, ...data } = s;
    await db.supplier.create({ data: { ...data, ...bank, contacts: { create: contacts.map(contactData) } } });
  }

  await seedQuotes(db);

  console.log("Seed done.");
  if (created.length) {
    const how = process.env.SEED_PASSWORD ? "the password in SEED_PASSWORD" : 'a random password (use "Forgot password" to set one)';
    console.log(`Sample users (${created.join(", ")}) were created with ${how}.`);
  }
}

const WITHHOLDING_RATES = [
  { code: "GOODS_1", label: "Goods 1%", lineKind: "GOODS", rate: "0.0100" },
  { code: "SERVICES_2", label: "Services 2%", lineKind: "SERVICES", rate: "0.0200" },
  { code: "GOV_PT_3", label: "Government percentage tax 3%", lineKind: "GOV_PT", rate: "0.0300" },
  { code: "GOV_VAT_5", label: "Government VAT 5%", lineKind: "GOV_VAT", rate: "0.0500" },
] as const;

type SeedLine = { description: string; kind: "GOODS" | "SERVICES"; qty: string; unit: string; supplier: string | null; supplierUnitCost: string; unitPrice: string };

const SAMPLE_NOTE = "Sample quote (fake data).";

/** Two sample quotes: a Draft for TESDA (goods + services), and a Won quote for Sample Corp with its sales order. */
async function seedQuotes(db: ReturnType<typeof connect>) {
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
  const rates = await db.withholdingRate.findMany();
  const snapshot = (codes: string[]): WithholdingSnapshot[] =>
    rates
      .filter((r) => codes.includes(r.code))
      .map((r) => ({ code: r.code, label: r.label, lineKind: r.lineKind, rate: Number(r.rate).toFixed(4), atcCode: r.atcCode }));
  const suppliers = await db.supplier.findMany();
  const supplierId = (name: string | null) => (name ? (suppliers.find((s) => s.name === name)?.id ?? null) : null);

  const today = manilaToday();
  const year = today.getUTCFullYear();
  const validUntil = new Date(today.getTime() + settings.quotes.defaultValidityDays * 86_400_000);

  async function makeQuote(customer: NonNullable<typeof tesda>, codes: string[], lines: SeedLine[], status: "DRAFT" | "WON") {
    const withholding = snapshot(codes);
    const items = lines.map((l, i) => ({
      sortOrder: i + 1,
      description: l.description,
      kind: l.kind,
      qty: l.qty,
      unit: l.unit,
      supplierId: supplierId(l.supplier),
      supplierUnitCost: l.supplierUnitCost,
      unitPrice: l.unitPrice,
      ...lineAmounts(l),
    }));
    const t = docTotals(items, withholding);
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
          terms: customer.defaultTerms,
          notes: SAMPLE_NOTE,
          settingsVersionId: version!.id,
          withholding,
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
    ["GOODS_1", "GOV_PT_3"],
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
        deliveryAddress: sampleCorp.address,
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
          })),
        },
      },
    });
    await tx.auditLog.create({ data: { userId: author!.id, entityType: "SalesOrder", entityId: so.id, action: "create", after: { number, fromQuote: won.number, sample: true } } });
  });
  console.log("Sample quotes: created a draft quote and a won quote with its sales order.");
}

function connect() {
  return new PrismaClient().$extends(noDeleteExtension);
}

const refusal = seedRefusal(process.env);
if (refusal) {
  console.error(refusal);
  process.exitCode = 1;
} else {
  const db = connect();
  main(db)
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
