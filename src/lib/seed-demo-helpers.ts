import { WITHHOLDING_DEFAULT_ROWS } from "./quotes/withholding-defaults.ts";
import type { WithholdingSnapshot } from "./quotes/calc.ts";
import type { SeedUser } from "./seed-base.ts";

export type SeedAddress = {
  kind: "BILLING" | "DELIVERY" | "OFFICE" | "WAREHOUSE" | "OTHER";
  label?: string;
  street: string;
  barangay: string;
  cityMunicipality: string;
  province: string;
  zip: string;
};

export type SeedContact = {
  name: string;
  role: string;
  email?: string;
  phone?: string;
  isMain?: boolean;
  active?: boolean;
};

export type SeedLine = {
  description: string;
  kind: "GOODS" | "SERVICES";
  qty: string;
  unit: string;
  supplier: string | null;
  supplierUnitCost: string;
  unitPrice: string;
};

export const SAMPLE_NOTE = "Sample quote (fake data).";

/** Resolve pick codes to snapshots from the shared default rate rows. */
export function snapshotsFromCodes(codes: readonly string[]): WithholdingSnapshot[] {
  const byCode = new Map(Object.values(WITHHOLDING_DEFAULT_ROWS).map((r) => [r.code, r]));
  const out: WithholdingSnapshot[] = [];
  for (const code of codes) {
    const r = byCode.get(code);
    if (!r) continue;
    out.push({ code: r.code, label: r.label, lineKind: r.lineKind, rate: r.rate, atcCode: r.atcCode });
  }
  return out;
}

/** First address of each kind is the default. */
export function addressData(list: SeedAddress[]) {
  const seen = new Set<string>();
  return list.map((a) => {
    const isDefault = !seen.has(a.kind);
    seen.add(a.kind);
    return { ...a, label: a.label ?? null, isDefault };
  });
}

export function contactData(c: SeedContact) {
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

export const DEMO_USERS: SeedUser[] = [
  { email: "jerwin@example.com", name: "Jerwin", isAdmin: true, isApprover: true, canSeeCosts: true },
  { email: "staff@example.com", name: "Maria Santos", isStaff: true, canSeeCosts: false },
  { email: "viewer@example.com", name: "Paolo Reyes", isViewer: true, canSeeCosts: false },
];

export const CUSTOMERS: {
  name: string;
  tin: string;
  addresses: SeedAddress[];
  withholdingType: "GOVERNMENT" | "TOP_WITHHOLDING_AGENT" | "NONE";
  defaultWithholding: string[];
  defaultTerms: string;
  contacts: SeedContact[];
}[] = [
  {
    name: "TESDA Regional Office",
    tin: "000-111-222-000",
    addresses: [
      { kind: "BILLING", label: "Regional office", street: "Sample Regional Office Bldg., 12 Sample Ave.", barangay: "Central", cityMunicipality: "Quezon City", province: "Metro Manila", zip: "1100" },
      { kind: "DELIVERY", label: "Training center", street: "Sample Training Center, 45 Sample Rd.", barangay: "Bagumbayan", cityMunicipality: "Quezon City", province: "Metro Manila", zip: "1110" },
    ],
    withholdingType: "GOVERNMENT",
    defaultWithholding: ["GOV_GOODS_1"],
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
    addresses: [
      { kind: "BILLING", street: "18F Sample Tower, Ortigas Center", barangay: "San Antonio", cityMunicipality: "Pasig City", province: "Metro Manila", zip: "1605" },
      { kind: "DELIVERY", label: "Warehouse", street: "Sample Warehouse 3, 7 Sample St.", barangay: "Ugong", cityMunicipality: "Pasig City", province: "Metro Manila", zip: "1604" },
    ],
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
    addresses: [{ kind: "BILLING", street: "88 Sample St.", barangay: "Poblacion", cityMunicipality: "Makati City", province: "Metro Manila", zip: "1210" }],
    withholdingType: "NONE",
    defaultWithholding: [],
    defaultTerms: "COD",
    contacts: [
      { name: "Juan Dela Cruz", role: "Other", phone: "0919 000 0006", isMain: true },
      { name: "Fe Dela Cruz", role: "Accounting", email: "fe.dc@example.com", active: false },
    ],
  },
];

export const SUPPLIERS: {
  name: string;
  tin?: string;
  addresses: SeedAddress[];
  taxType: "VAT" | "NON_VAT" | "NO_RECEIPT";
  defaultTerms: string;
  bank?: { bankAccountName: string; bankAccountNumber: string; bankBranch: string; bankNotes?: string };
  contacts: SeedContact[];
}[] = [
  {
    name: "UNO Computer Supply",
    tin: "000-777-888-000",
    addresses: [{ kind: "OFFICE", street: "Unit 5, Sample Building, Gilmore Ave.", barangay: "Valencia", cityMunicipality: "Quezon City", province: "Metro Manila", zip: "1112" }],
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
    addresses: [{ kind: "OFFICE", street: "Stall 21, Sample Mall, Sample Blvd.", barangay: "Barangay 659", cityMunicipality: "Manila", province: "Metro Manila", zip: "1000" }],
    taxType: "NON_VAT",
    defaultTerms: "COD",
    contacts: [
      { name: "Jun Mercado", role: "Other", phone: "0921 000 0009", isMain: true },
      { name: "Kim Bautista", role: "Accounting", email: "kim.b@example.com", active: false },
    ],
  },
  {
    name: "Gilmore Street Seller",
    addresses: [{ kind: "OFFICE", street: "Gilmore Ave. corner Sample St.", barangay: "Valencia", cityMunicipality: "Quezon City", province: "Metro Manila", zip: "1112" }],
    taxType: "NO_RECEIPT",
    defaultTerms: "COD",
    contacts: [
      { name: "Leo Garcia", role: "Other", phone: "0922 000 0010", isMain: true },
      { name: "Mia Garcia", role: "Other", phone: "0922 000 0011", active: false },
    ],
  },
];
