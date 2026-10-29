// Sample data: `npm run db:seed`. Safe to run more than once (it only adds
// what's missing and never deletes). All people, TINs and bank numbers are fake.
//
// Passwords: in development every sample user gets the clearly fake password
// below (or SEED_PASSWORD), printed to the console. In production, random
// passwords are set and NOT printed — use "Forgot password" to sign in.

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { noDeleteExtension } from "../src/lib/no-delete.ts";
import { DEFAULT_SETTINGS } from "../src/lib/settings/defaults.ts";

const db = new PrismaClient().$extends(noDeleteExtension);
const isProd = process.env.NODE_ENV === "production";
const DEV_PASSWORD = process.env.SEED_PASSWORD || "fake-dev-password-123";

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

async function main() {
  // Settings: version 1 from defaults, only if there is none yet.
  if ((await db.settingsVersion.count()) === 0) {
    await db.settingsVersion.create({ data: { version: 1, data: DEFAULT_SETTINGS } });
    console.log("Settings: created version 1 from defaults.");
  }

  const passwords: { email: string; password: string }[] = [];
  for (const u of USERS) {
    const existing = await db.user.findUnique({ where: { email: u.email } });
    if (existing) continue;
    const password = isProd ? randomBytes(24).toString("base64url") : DEV_PASSWORD;
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
    passwords.push({ email: u.email, password });
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
  if (passwords.length && !isProd) {
    console.log("\nSample sign-ins (development only, fake passwords):");
    for (const p of passwords) console.log(`  ${p.email}  /  ${p.password}`);
  } else if (passwords.length) {
    console.log(`Created ${passwords.length} users with random passwords. Use "Forgot password" to sign in.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
