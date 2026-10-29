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
  defaultTerms: string;
  contacts: SeedContact[];
}[] = [
  {
    name: "TESDA Regional Office",
    tin: "000-111-222-000",
    address: "Sample Regional Office, Quezon City, Metro Manila",
    withholdingType: "GOVERNMENT",
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

  for (const c of CUSTOMERS) {
    if (await db.customer.findFirst({ where: { name: c.name } })) continue;
    const { contacts, ...data } = c;
    await db.customer.create({ data: { ...data, contacts: { create: contacts.map(contactData) } } });
  }

  for (const s of SUPPLIERS) {
    if (await db.supplier.findFirst({ where: { name: s.name } })) continue;
    const { contacts, bank, ...data } = s;
    await db.supplier.create({ data: { ...data, ...bank, contacts: { create: contacts.map(contactData) } } });
  }

  console.log("Seed done.");
  if (created.length) {
    const how = process.env.SEED_PASSWORD ? "the password in SEED_PASSWORD" : 'a random password (use "Forgot password" to set one)';
    console.log(`Sample users (${created.join(", ")}) were created with ${how}.`);
  }
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
