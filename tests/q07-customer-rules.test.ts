import { beforeEach, describe, expect, it, vi } from "vitest";
import { contactSchema, customerSchema, PHONE_FORMAT_MESSAGE } from "@/lib/validation/companies";
import { convertInputSchema } from "@/lib/validation/quotes";
import { normalizeTin } from "@/lib/validation/tin";
import { DocRuleError } from "@/lib/documents/common";

type Row = Record<string, unknown> & { id: string };

const fake = vi.hoisted(() => {
  const state = {
    customers: [] as Row[],
    addresses: [] as Row[],
    contacts: [] as Row[],
    quotes: [] as Row[],
    salesOrders: [] as Row[],
    audits: [] as Row[],
    documentAttachments: [] as Row[],
    withholdingRates: [
      { id: "wh_1", code: "GOODS_1", rate: "0.01", label: "Goods 1%", active: true, sortOrder: 1 },
    ] as Row[],
    settings: {
      numbering: { salesOrder: "SO-{YYYY}-{####}" },
      lists: { paymentTerms: ["COD", "Net 15", "Net 30"] },
    },
    n: 0,
  };
  const id = () => `id_${++state.n}`;
  const matches = (row: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([k, v]) => (k === "NOT" ? !matches(row, v as Record<string, unknown>) : row[k] === v));

  const table = (rows: () => Row[], name: string, defaults: Record<string, unknown> = {}) => ({
    async findFirst({ where }: { where: Record<string, unknown> }) {
      return rows().find((r) => matches(r, where)) ?? null;
    },
    async findMany({ where }: { where?: Record<string, unknown> } = {}) {
      if (!where) return [...rows()];
      return rows().filter((r) => matches(r, where));
    },
    async findUnique({ where, include }: { where: Record<string, unknown>; include?: Record<string, unknown> }) {
      const r = rows().find((x) => matches(x, where));
      if (!r) return null;
      const res = { ...r };
      if (include?.addresses) {
        res.addresses = state.addresses.filter((a) => a.customerId === r.id && !a.archivedAt);
      }
      return res;
    },
    async findUniqueOrThrow({ where, include }: { where: Record<string, unknown>; include?: Record<string, unknown> }) {
      const r = rows().find((x) => matches(x, where));
      if (!r) throw new Error(`${name} not found`);
      const res = { ...r };
      if (include?.addresses) {
        res.addresses = state.addresses.filter((a) => a.customerId === r.id && !a.archivedAt);
      }
      return res;
    },
    async create({ data }: { data: Record<string, unknown> }) {
      const row = { id: id(), createdAt: new Date(), updatedAt: new Date(), ...defaults, ...data } as Row;
      rows().push(row);
      return row;
    },
    async update({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      const r = rows().find((x) => matches(x, where));
      if (!r) throw new Error(`${name} not found`);
      Object.assign(r, data, { updatedAt: new Date() });
      return r;
    },
  });

  const client: Record<string, unknown> = {
    customer: table(() => state.customers, "customer", { active: true, archivedAt: null }),
    address: table(() => state.addresses, "address", { archivedAt: null, needsReview: false }),
    contact: table(() => state.contacts, "contact", { active: true, archivedAt: null }),
    quote: table(() => state.quotes, "quote"),
    salesOrder: table(() => state.salesOrders, "salesOrder"),
    auditLog: table(() => state.audits, "audit"),
    documentAttachment: {
      async count({ where }: { where: Record<string, unknown> }) {
        return state.documentAttachments.filter((r) => matches(r, where)).length;
      },
    },
    withholdingRate: table(() => state.withholdingRates, "withholdingRate"),
    // Phase 4 #10: convertQuoteToSalesOrder calls assertPeriodOpen, which
    // looks up the PeriodLock row for the SO month. No rows here = open.
    periodLock: {
      async findUnique() {
        return null;
      },
    },
    series: {
      async upsert() {
        return { seq: 1 };
      },
    },
    async $transaction(fn: (tx: unknown) => Promise<unknown>) {
      return fn(client);
    },
    async $queryRaw() {
      return [{ id: "1" }];
    },
    async $executeRaw() {
      return 1;
    },
  };

  return { state, client };
});

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  db: fake.client,
}));

const adminUser = {
  id: "u_admin",
  isAdmin: true,
  isApprover: true,
  isStaff: true,
  isViewer: false,
  active: true,
  canSeeCosts: true,
};

vi.mock("@/lib/auth/current-user", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/current-user")>()),
  requireActionPermission: async () => adminUser,
  requirePagePermission: async () => adminUser,
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("next/navigation", () => ({
  redirect: () => {},
}));

vi.mock("@/lib/settings", () => ({
  getSettingsSnapshot: async () => ({
    settings: {
      numbering: { salesOrder: "SO-{YYYY}-{####}" },
      lists: { paymentTerms: ["COD", "Net 15", "Net 30"] },
    },
  }),
}));

const { createCustomerForQuoteAction } = await import("@/app/(app)/quotes/create-customer-action");
const { saveCustomerAction } = await import("@/app/(app)/customers/actions");
const { duplicateCustomer } = await import("@/lib/services/companies");
const { convertQuoteToSalesOrder } = await import("@/lib/services/quotes");

const TERMS = ["COD", "Net 15", "Net 30"];
const ROLES = ["Procurement", "Accounting"];

beforeEach(() => {
  fake.state.customers = [];
  fake.state.addresses = [];
  fake.state.contacts = [];
  fake.state.quotes = [];
  fake.state.salesOrders = [];
  fake.state.audits = [];
  fake.state.documentAttachments = [];
});

describe("Q07 S-77: Phone and email format validation", () => {
  const baseContact = { name: "Ana Santos", role: "Procurement", email: "", phone: "", isMain: false };

  it("refuses non-phone characters like 'abc' with a clear message", () => {
    const res = contactSchema(ROLES).safeParse({ ...baseContact, phone: "abc" });
    expect(res.success).toBe(false);
    expect(
      res.error?.issues.some(
        (i) => i.path.includes("phone") && i.message.includes(PHONE_FORMAT_MESSAGE),
      ),
    ).toBe(true);
  });

  it("accepts valid phone numbers with digits, +, spaces, and dashes", () => {
    expect(contactSchema(ROLES).safeParse({ ...baseContact, phone: "+63 917 123-4567" }).success).toBe(true);
    expect(contactSchema(ROLES).safeParse({ ...baseContact, phone: "0917-123-4567" }).success).toBe(true);
    expect(contactSchema(ROLES).safeParse({ ...baseContact, phone: "02 8123 4567" }).success).toBe(true);
    expect(contactSchema(ROLES).safeParse({ ...baseContact, phone: "09171234567" }).success).toBe(true);
  });

  it("validates email address format", () => {
    expect(contactSchema(ROLES).safeParse({ ...baseContact, email: "invalid-email" }).success).toBe(false);
    expect(contactSchema(ROLES).safeParse({ ...baseContact, email: "ana@example.com" }).success).toBe(true);
  });

  it("normalizes and validates TIN correctly", () => {
    expect(normalizeTin("123-456-789")).toBe("123-456-789-000");
    expect(normalizeTin("abc")).toBe("invalid");
  });
});

describe("Q07 S-24: Customer payment terms & addresses", () => {
  const baseCustomer = {
    name: "Acme Corp",
    tin: "123-456-789-000",
    withholdingType: "NONE" as const,
    defaultWithholding: [] as string[],
    defaultTerms: "Net 30",
    notes: "",
  };

  it("requires payment terms from the settled list", () => {
    expect(customerSchema(TERMS).safeParse({ ...baseCustomer, defaultTerms: "" }).success).toBe(false);
    expect(customerSchema(TERMS).safeParse({ ...baseCustomer, defaultTerms: "Net 90" }).success).toBe(false);
    expect(customerSchema(TERMS).safeParse({ ...baseCustomer, defaultTerms: "Net 30" }).success).toBe(true);
  });
});

describe("Q07 S-68: Quick-add customer on a quote", () => {
  it("all-or-nothing: bad email creates no customer or contact in DB", async () => {
    const fd = new FormData();
    fd.set("name", "Test Customer");
    fd.set("withholdingType", "NONE");
    fd.set("defaultTerms", "Net 30");
    fd.set("contactName", "Contact Person");
    fd.set("email", "bad-email");
    fd.set("phone", "0917-123-4567");
    fd.set("address", "123 Main St, Pasig");

    const res = await createCustomerForQuoteAction({}, fd);
    expect(res.ok).toBeFalsy();
    expect(res.customer).toBeUndefined();
    expect(res.fieldErrors?.email).toBeDefined();

    // Verify nothing was saved in DB
    expect(fake.state.customers).toHaveLength(0);
    expect(fake.state.addresses).toHaveLength(0);
    expect(fake.state.contacts).toHaveLength(0);
  });

  it("all-or-nothing: bad phone creates no customer in DB", async () => {
    const fd = new FormData();
    fd.set("name", "Test Customer");
    fd.set("withholdingType", "NONE");
    fd.set("defaultTerms", "Net 30");
    fd.set("contactName", "Contact Person");
    fd.set("email", "valid@example.com");
    fd.set("phone", "abc");
    fd.set("address", "123 Main St, Pasig");

    const res = await createCustomerForQuoteAction({}, fd);
    expect(res.ok).toBeFalsy();
    expect(res.fieldErrors?.phone).toBeDefined();
    expect(fake.state.customers).toHaveLength(0);
  });

  it("saves address into Address rows (Billing + Delivery, both default) and not customer free-text", async () => {
    const fd = new FormData();
    fd.set("name", "Good Customer");
    fd.set("withholdingType", "NONE");
    fd.set("defaultTerms", "Net 30");
    fd.set("address", "Unit 10A, Ayala Tower, Makati");
    fd.set("contactName", "John Doe");
    fd.set("email", "john@example.com");
    fd.set("phone", "+63 917 000-0000");

    const res = await createCustomerForQuoteAction({}, fd);
    expect(res.ok).toBe(true);
    expect(res.customer).toBeDefined();

    // Verify customer was created without old free-text address column
    expect(fake.state.customers).toHaveLength(1);
    expect(fake.state.customers[0]?.name).toBe("Good Customer");
    expect(fake.state.customers[0]?.address).toBeUndefined();

    // Verify Address rows: Billing and Delivery, both default
    const addrs = fake.state.addresses.filter((a) => a.customerId === res.customer?.id);
    expect(addrs).toHaveLength(2);
    const billing = addrs.find((a) => a.kind === "BILLING");
    const delivery = addrs.find((a) => a.kind === "DELIVERY");
    expect(billing?.isDefault).toBe(true);
    expect(billing?.street).toBe("Unit 10A, Ayala Tower, Makati");
    expect(delivery?.isDefault).toBe(true);
    expect(delivery?.street).toBe("Unit 10A, Ayala Tower, Makati");
  });

  it("saves split address parts on both rows and clears needs-review when complete", async () => {
    const fd = new FormData();
    fd.set("name", "Split Address Corp");
    fd.set("withholdingType", "NONE");
    fd.set("defaultTerms", "Net 30");
    fd.set("address", "Bldg.14, Gate 2, TESDA Complex, East Service Rd, SLEX");
    fd.set("barangay", "San Antonio");
    fd.set("cityMunicipality", "Taguig City");
    fd.set("province", "Metro Manila");
    fd.set("zip", "1630");
    fd.set("contactName", "John Doe");
    fd.set("email", "john@example.com");
    fd.set("phone", "+63 917 000-0000");

    const res = await createCustomerForQuoteAction({}, fd);
    expect(res.ok).toBe(true);

    const addrs = fake.state.addresses.filter((a) => a.customerId === res.customer?.id);
    expect(addrs).toHaveLength(2);
    for (const a of addrs) {
      expect(a.street).toBe("Bldg.14, Gate 2, TESDA Complex, East Service Rd, SLEX");
      expect(a.barangay).toBe("San Antonio");
      expect(a.cityMunicipality).toBe("Taguig City");
      expect(a.province).toBe("Metro Manila");
      expect(a.zip).toBe("1630");
      expect(a.isDefault).toBe(true);
      expect(a.needsReview).toBe(false);
    }
  });

  it("street-only address keeps needs-review true and leaves parts blank", async () => {
    const fd = new FormData();
    fd.set("name", "Street Only Corp");
    fd.set("withholdingType", "NONE");
    fd.set("defaultTerms", "Net 30");
    fd.set("address", "123 Main St, Pasig");
    fd.set("contactName", "John Doe");
    fd.set("email", "john@example.com");
    fd.set("phone", "+63 917 000-0000");

    const res = await createCustomerForQuoteAction({}, fd);
    expect(res.ok).toBe(true);

    const addrs = fake.state.addresses.filter((a) => a.customerId === res.customer?.id);
    expect(addrs).toHaveLength(2);
    for (const a of addrs) {
      expect(a.street).toBe("123 Main St, Pasig");
      expect(a.barangay).toBe("");
      expect(a.cityMunicipality).toBe("");
      expect(a.province).toBe("");
      expect(a.zip).toBe("");
      expect(a.needsReview).toBe(true);
    }
  });
});

describe("Q07 S-76: SO convert requires a delivery address", () => {
  it("convertInputSchema validates delivery address ID", () => {
    const valid = convertInputSchema.safeParse({
      buyerPoNo: "PO-123",
      buyerPoDate: "2026-11-02",
      deliveryAddressId: "addr_123",
      deliveryAddress: "Some text",
    });
    expect(valid.success).toBe(true);
  });

  it("convertQuoteToSalesOrder throws DocRuleError if delivery address ID is missing", async () => {
    fake.state.customers.push({ id: "cust_1", name: "Cust 1" });
    fake.state.quotes.push({
      id: "q_1",
      number: "Q-2026-0001",
      customerId: "cust_1",
      status: "DRAFT",
      approvalStatus: "APPROVED",
      items: [],
      withholding: [],
      contractPrice: "0",
      withholdingTotal: "0",
      netReceived: "0",
      supplierCost: "0",
      netMargin: "0",
      netMarginPct: "0",
    });

    await expect(
      convertQuoteToSalesOrder(
        "q_1",
        { buyerPoNo: null, deliveryAddressId: null },
        adminUser,
      ),
    ).rejects.toBeInstanceOf(DocRuleError);
  });

  it("convertQuoteToSalesOrder throws DocRuleError if delivery address belongs to another customer", async () => {
    fake.state.customers.push({ id: "cust_1", name: "Cust 1" }, { id: "cust_2", name: "Cust 2" });
    fake.state.addresses.push({
      id: "addr_other",
      customerId: "cust_2",
      kind: "DELIVERY",
      street: "Other street",
      barangay: "B",
      cityMunicipality: "C",
      province: "P",
      zip: "1000",
    });
    fake.state.quotes.push({
      id: "q_2",
      number: "Q-2026-0002",
      customerId: "cust_1",
      status: "DRAFT",
      approvalStatus: "APPROVED",
      items: [],
      withholding: [],
      contractPrice: "0",
      withholdingTotal: "0",
      netReceived: "0",
      supplierCost: "0",
      netMargin: "0",
      netMarginPct: "0",
    });

    await expect(
      convertQuoteToSalesOrder(
        "q_2",
        { buyerPoNo: null, deliveryAddressId: "addr_other" },
        adminUser,
      ),
    ).rejects.toThrow(/That delivery address doesn't belong to this customer/);
  });
});

describe("Audit: conversion needs customer-acceptance evidence", () => {
  const setupQuote = () => {
    fake.state.customers.push({ id: "cust_1", name: "Cust 1" });
    fake.state.addresses.push({
      id: "addr_1",
      customerId: "cust_1",
      kind: "DELIVERY",
      street: "1 Main St",
      barangay: "B",
      cityMunicipality: "C",
      province: "P",
      zip: "1000",
      archivedAt: null,
    });
    fake.state.quotes.push({
      id: "q_1",
      number: "Q-2026-0001",
      customerId: "cust_1",
      status: "DRAFT",
      approvalStatus: "APPROVED",
      acceptedAt: null,
      acceptedBy: null,
      acceptedVia: null,
      items: [],
      withholding: [],
      contractPrice: "0",
      withholdingTotal: "0",
      netReceived: "0",
      supplierCost: "0",
      netMargin: "0",
      netMarginPct: "0",
    });
  };

  it("throws when there is no conforme, no buyer PO, and no recorded acceptance", async () => {
    setupQuote();
    await expect(
      convertQuoteToSalesOrder("q_1", { buyerPoNo: null, deliveryAddressId: "addr_1" }, adminUser),
    ).rejects.toThrow(/Record customer acceptance first/);
  });

  it("converts with a buyer PO number and no other evidence", async () => {
    setupQuote();
    const so = await convertQuoteToSalesOrder("q_1", { buyerPoNo: "PO-77", deliveryAddressId: "addr_1" }, adminUser);
    expect(so.buyerPoNo).toBe("PO-77");
  });

  it("converts with a recorded acceptance and no buyer PO", async () => {
    setupQuote();
    const q = fake.state.quotes[0]!;
    q.acceptedAt = new Date("2026-11-05T00:00:00.000Z");
    q.acceptedBy = "Ana Santos";
    q.acceptedVia = "EMAIL";
    const so = await convertQuoteToSalesOrder("q_1", { buyerPoNo: null, deliveryAddressId: "addr_1" }, adminUser);
    expect(so.quoteId).toBe("q_1");
  });

  it("converts with a signed conforme file and no buyer PO", async () => {
    setupQuote();
    fake.state.documentAttachments.push({ id: "att_1", quoteId: "q_1", archivedAt: null, fileName: "conforme.pdf" });
    const so = await convertQuoteToSalesOrder("q_1", { buyerPoNo: null, deliveryAddressId: "addr_1" }, adminUser);
    expect(so.quoteId).toBe("q_1");
  });

  it("an archived conforme file does not count as evidence", async () => {
    setupQuote();
    fake.state.documentAttachments.push({ id: "att_1", quoteId: "q_1", archivedAt: new Date(), fileName: "conforme.pdf" });
    await expect(
      convertQuoteToSalesOrder("q_1", { buyerPoNo: null, deliveryAddressId: "addr_1" }, adminUser),
    ).rejects.toThrow(/Record customer acceptance first/);
  });
});

describe("Q07 S-24: Duplicate customer copy", () => {
  it("creates copy with name + (copy), TIN blank, and copies all active addresses", async () => {
    const origCust = {
      id: "cust_orig",
      name: "Original Corp",
      tin: "111-222-333-000",
      withholdingType: "GOVERNMENT",
      defaultWithholding: ["GOODS_1"],
      defaultTerms: "Net 30",
      notes: "VIP account",
      active: true,
      archivedAt: null,
    };
    fake.state.customers.push(origCust);

    fake.state.addresses.push(
      {
        id: "addr_1",
        customerId: origCust.id,
        kind: "BILLING",
        label: "Headquarters",
        street: "123 Finance St",
        barangay: "San Lorenzo",
        cityMunicipality: "Makati",
        province: "Metro Manila",
        zip: "1223",
        isDefault: true,
        archivedAt: null,
      },
      {
        id: "addr_2",
        customerId: origCust.id,
        kind: "DELIVERY",
        label: "Warehouse 1",
        street: "456 Port Road",
        barangay: "South Harbor",
        cityMunicipality: "Manila",
        province: "Metro Manila",
        zip: "1018",
        isDefault: true,
        archivedAt: null,
      },
      {
        id: "addr_archived",
        customerId: origCust.id,
        kind: "OTHER",
        label: "Old site",
        street: "Old road",
        archivedAt: new Date(),
      },
    );

    const dup = await duplicateCustomer(origCust.id, "u_admin");
    expect(dup.name).toBe("Original Corp (copy)");
    expect(dup.tin).toBeNull(); // TIN blank!
    expect(dup.defaultTerms).toBe("Net 30");
    expect(dup.withholdingType).toBe("GOVERNMENT");

    // Check copied addresses
    const copiedAddrs = fake.state.addresses.filter((a) => a.customerId === dup.id);
    expect(copiedAddrs).toHaveLength(2); // Only active addresses copied
    const billingCopy = copiedAddrs.find((a) => a.kind === "BILLING");
    const deliveryCopy = copiedAddrs.find((a) => a.kind === "DELIVERY");
    expect(billingCopy?.street).toBe("123 Finance St");
    expect(billingCopy?.label).toBe("Headquarters");
    expect(billingCopy?.isDefault).toBe(true);
    expect(deliveryCopy?.street).toBe("456 Port Road");
    expect(deliveryCopy?.isDefault).toBe(true);
  });

  it("keeps the (copy) suffix when the name is already 191 characters", async () => {
    const origCust = {
      id: "cust_long",
      name: "L".repeat(191),
      tin: "222-333-444-000",
      withholdingType: "NONE",
      defaultWithholding: [],
      defaultTerms: null,
      notes: null,
      active: true,
      archivedAt: null,
    };
    fake.state.customers.push(origCust);
    const dup = await duplicateCustomer(origCust.id, "u_admin");
    expect(dup.name.endsWith(" (copy)")).toBe(true);
    expect(dup.name.length).toBeLessThanOrEqual(191);
    expect(dup.tin).toBeNull();
    expect(dup.defaultTerms).toBeNull();
  });
});

function customerForm(extra: Record<string, string> = {}) {
  const fd = new FormData();
  const fields: Record<string, string> = {
    name: "Acme Trading",
    tin: "",
    withholdingType: "NONE",
    defaultWithholdingJson: "[]",
    defaultTerms: "Net 30",
    notes: "",
    isBilling: "true",
    sameAsBilling: "true",
    street: "12 Rizal St",
    barangay: "San Antonio",
    cityMunicipality: "Pasig",
    province: "Metro Manila",
    zip: "1605",
    ...extra,
  };
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("Q07 customer save: address flags and legacy terms", () => {
  it("saves billing and a separate delivery address when Same as billing is off", async () => {
    const res = await saveCustomerAction(
      null,
      {},
      customerForm({
        sameAsBilling: "false",
        isDelivery: "true",
        deliveryStreet: "88 Commerce Ave",
        deliveryBarangay: "Manggahan",
        deliveryCityMunicipality: "Pasig",
        deliveryProvince: "Metro Manila",
        deliveryZip: "1611",
      }),
    );
    expect(res.ok).toBe(true);
    expect(fake.state.customers).toHaveLength(1);
    const id = fake.state.customers[0]!.id;
    const addrs = fake.state.addresses.filter((a) => a.customerId === id);
    expect(addrs.find((a) => a.kind === "BILLING")?.street).toBe("12 Rizal St");
    expect(addrs.find((a) => a.kind === "DELIVERY")?.street).toBe("88 Commerce Ave");
    expect(addrs.find((a) => a.kind === "BILLING")?.isDefault).toBe(true);
    expect(addrs.find((a) => a.kind === "DELIVERY")?.isDefault).toBe(true);
  });

  it("saves a delivery address when the billing street is blank", async () => {
    const res = await saveCustomerAction(
      null,
      {},
      customerForm({
        street: "",
        barangay: "",
        cityMunicipality: "",
        province: "",
        zip: "",
        sameAsBilling: "false",
        isDelivery: "true",
        deliveryStreet: "88 Commerce Ave",
        deliveryBarangay: "Manggahan",
        deliveryCityMunicipality: "Pasig",
        deliveryProvince: "Metro Manila",
        deliveryZip: "1611",
      }),
    );
    expect(res.ok).toBe(true);
    expect(fake.state.customers).toHaveLength(1);
    const id = fake.state.customers[0]!.id;
    const addrs = fake.state.addresses.filter((a) => a.customerId === id);
    expect(addrs).toHaveLength(1);
    expect(addrs[0]).toMatchObject({
      kind: "DELIVERY",
      street: "88 Commerce Ave",
      barangay: "Manggahan",
      cityMunicipality: "Pasig",
      province: "Metro Manila",
      zip: "1611",
      isDefault: true,
    });
  });

  it("does not create a customer when the address is incomplete", async () => {
    const res = await saveCustomerAction(null, {}, customerForm({ barangay: "", cityMunicipality: "", province: "", zip: "" }));
    expect(res.ok).toBeFalsy();
    expect(res.fieldErrors?.barangay).toBeDefined();
    expect(fake.state.customers).toHaveLength(0);
    expect(fake.state.addresses).toHaveLength(0);
  });

  it("keeps blank terms and a term that is no longer in Settings when editing", async () => {
    fake.state.customers.push({
      id: "cust_old",
      name: "Old Buyer",
      tin: null,
      withholdingType: "NONE",
      defaultWithholding: [],
      defaultTerms: null,
      notes: "keep me",
      active: true,
      archivedAt: null,
    });
    const blank = await saveCustomerAction("cust_old", {}, customerForm({ name: "Old Buyer", defaultTerms: "", notes: "still here", street: "" }));
    expect(blank.ok).toBe(true);
    expect(fake.state.customers.find((c) => c.id === "cust_old")?.defaultTerms).toBeNull();
    expect(fake.state.customers.find((c) => c.id === "cust_old")?.notes).toBe("still here");

    fake.state.customers[0]!.defaultTerms = "50% on delivery";
    const kept = await saveCustomerAction(
      "cust_old",
      {},
      customerForm({ name: "Old Buyer", defaultTerms: "50% on delivery", notes: "still here", street: "" }),
    );
    expect(kept.ok).toBe(true);
    expect(fake.state.customers.find((c) => c.id === "cust_old")?.defaultTerms).toBe("50% on delivery");
  });
});
