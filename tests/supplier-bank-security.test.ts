import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bankNumberDraft,
  bankViewActivityLabel,
  extractLast4,
  maskBankAccountNumber,
  maskSupplierForViewer,
  maskSuppliersForViewer,
  resolveBankAccountNumber,
} from "@/lib/bank-mask";
import { ForbiddenError, roleFlags, type PermissionUser, type Role } from "@/lib/permissions";
import { auditDiff, auditDisplayValue, writeAudit } from "@/lib/audit";
import type { Db } from "@/lib/db";

type Row = Record<string, unknown> & { id: string };

const fake = vi.hoisted(() => {
  process.env.SESSION_SECRET ??= "test-secret-at-least-16-chars";
  const state = {
    suppliers: [] as Row[],
    users: [] as Row[],
    audits: [] as Row[],
    settings: [] as Row[],
    currentUser: null as (PermissionUser & { id: string }) | null,
    n: 0,
  };
  const id = () => `sup-${++state.n}`;
  const matches = (row: Row, where?: Record<string, unknown>): boolean =>
    !where || Object.entries(where).every(([k, v]) => (k === "NOT" ? !matches(row, v as Record<string, unknown>) : row[k] === v));

  const table = (rows: () => Row[], name: string, defaults: Record<string, unknown> = {}) => ({
    async findFirst(args: { where?: Record<string, unknown> } = {}) {
      const r = rows().find((x) => matches(x, args.where));
      return r ? { ...r } : null;
    },
    async findUnique({ where }: { where: Record<string, unknown> }) {
      const r = rows().find((x) => matches(x, where));
      return r ? { ...r } : null;
    },
    async findUniqueOrThrow({ where }: { where: Record<string, unknown> }) {
      const r = rows().find((x) => matches(x, where));
      if (!r) throw new Error(`${name} not found`);
      return { ...r };
    },
    async create({ data }: { data: Record<string, unknown> }) {
      const row = { id: id(), createdAt: new Date(), ...defaults, ...data } as Row;
      rows().push(row);
      return { ...row };
    },
    async update({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      const r = rows().find((x) => matches(x, where));
      if (!r) throw new Error(`${name} not found`);
      Object.assign(r, data);
      return { ...r };
    },
  });

  const client: Record<string, unknown> = {
    supplier: table(() => state.suppliers, "supplier"),
    user: table(() => state.users, "user", { active: true }),
    auditLog: table(() => state.audits, "auditLog"),
    settingsVersion: table(() => state.settings, "settingsVersion"),
    async $transaction(fn: (tx: unknown) => Promise<unknown>) {
      return fn(client);
    },
  };
  return { state, client };
});

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  db: fake.client,
}));

vi.mock("@/lib/auth/current-user", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/current-user")>()),
  getCurrentUser: async () => fake.state.currentUser,
  requireActionPermission: async () => {
    if (!fake.state.currentUser) throw new ForbiddenError();
    return fake.state.currentUser;
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("next/navigation", () => ({
  redirect: () => {},
}));

const { saveSupplier, revealSupplierBankAccount, CompanyRuleError } = await import("@/lib/services/companies");
const { saveSupplierAction, revealSupplierBankAccountAction } = await import("@/app/(app)/suppliers/actions");

function user(roles: Role[], extra: Partial<PermissionUser & { id: string }> = {}): PermissionUser & { id: string } {
  return { id: "test-user-id", ...roleFlags(roles), active: true, canSeeCosts: false, ...extra };
}

describe("1. Bank mask helper (src/lib/bank-mask.ts)", () => {
  it("masks account numbers to last 4 only with '•••• 1234' format", () => {
    expect(maskBankAccountNumber("123456789012")).toBe("•••• 9012");
    expect(maskBankAccountNumber("0000-0000-4321")).toBe("•••• 4321");
    expect(maskBankAccountNumber("9876")).toBe("•••• 9876");
  });

  it("leaves null, undefined, and empty string as empty string", () => {
    expect(maskBankAccountNumber(null)).toBe("");
    expect(maskBankAccountNumber(undefined)).toBe("");
    expect(maskBankAccountNumber("")).toBe("");
    expect(maskBankAccountNumber("   ")).toBe("");
  });

  it("handles numbers shorter than 4 characters", () => {
    expect(maskBankAccountNumber("42")).toBe("•••• 42");
    expect(maskBankAccountNumber("1")).toBe("•••• 1");
  });

  it("does not corrupt an already-masked value, including short numbers", () => {
    expect(maskBankAccountNumber("•••• 9012")).toBe("•••• 9012");
    expect(maskBankAccountNumber("•••• 42")).toBe("•••• 42");
    expect(maskBankAccountNumber("  •••• 1  ")).toBe("•••• 1");
  });

  it("keeps the edit box empty unless the Admin typed a new number", () => {
    expect(bankNumberDraft("")).toBe("");
    expect(bankNumberDraft("•••• 9012")).toBe("");
    expect(bankNumberDraft(null)).toBe("");
    expect(bankNumberDraft("123412341234")).toBe("123412341234");
  });

  it("keeps the stored number when the edit submits blank or a mask", () => {
    expect(resolveBankAccountNumber("", "998877665544")).toBe("998877665544");
    expect(resolveBankAccountNumber(null, "998877665544")).toBe("998877665544");
    expect(resolveBankAccountNumber("•••• 5544", "998877665544")).toBe("998877665544");
    expect(resolveBankAccountNumber("123412341234", "998877665544")).toBe("123412341234");
    expect(resolveBankAccountNumber("•••• 5544", null)).toBe(null);
  });

  it("extracts last 4 characters correctly", () => {
    expect(extractLast4("1234567890")).toBe("7890");
    expect(extractLast4("42")).toBe("42");
    expect(extractLast4(null)).toBe("");
    expect(extractLast4("")).toBe("");
  });
});

describe("2. Masking per role (Staff/Approver/Viewer masked, Admin full via reveal)", () => {
  const rawSupplier = {
    id: "sup-100",
    name: "Acme Supplies",
    tin: "123-456-789-000",
    bankAccountName: "Acme Corp",
    bankAccountNumber: "998877665544",
    bankBranch: "Ortigas",
    bankNotes: "Main account",
  };

  it("masks bank account number for Staff, Approver, and Viewer", () => {
    const staff = user(["STAFF"]);
    const approver = user(["APPROVER"]);
    const viewer = user(["VIEWER"]);

    const staffView = maskSupplierForViewer(rawSupplier, staff);
    expect(staffView.bankAccountNumber).toBe("•••• 5544");
    expect(staffView.bankAccountNumber).not.toContain("9988");

    const approverView = maskSupplierForViewer(rawSupplier, approver);
    expect(approverView.bankAccountNumber).toBe("•••• 5544");

    const viewerView = maskSupplierForViewer(rawSupplier, viewer);
    expect(viewerView.bankAccountNumber).toBe("•••• 5544");
  });

  it("masks for inactive Admin or unauthenticated users", () => {
    const inactiveAdmin = user(["ADMIN"], { active: false });
    expect(maskSupplierForViewer(rawSupplier, inactiveAdmin).bankAccountNumber).toBe("•••• 5544");
    expect(maskSupplierForViewer(rawSupplier, null).bankAccountNumber).toBe("•••• 5544");
    expect(maskSupplierForViewer(rawSupplier, undefined).bankAccountNumber).toBe("•••• 5544");
  });

  it("masks in bulk via maskSuppliersForViewer for non-Admins", () => {
    const staff = user(["STAFF"]);
    const list = maskSuppliersForViewer([rawSupplier], staff);
    expect(list[0]!.bankAccountNumber).toBe("•••• 5544");
  });

  it("masks the page and list payload for an active Admin (full number is reveal-only)", () => {
    const admin = user(["ADMIN"], { id: "admin-view" });
    const view = maskSupplierForViewer(rawSupplier, admin);
    expect(view.bankAccountNumber).toBe("•••• 5544");
    expect(JSON.stringify(view)).not.toContain("998877665544");

    const list = maskSuppliersForViewer([rawSupplier], admin);
    expect(list[0]!.bankAccountNumber).toBe("•••• 5544");
    expect(JSON.stringify(list)).not.toContain("998877665544");
  });

  it("allows only active Admin to reveal full bank account number", async () => {
    fake.state.suppliers = [{ ...rawSupplier }];
    const admin = user(["ADMIN"], { id: "admin-1" });
    const staff = user(["STAFF"], { id: "staff-1" });
    const approver = user(["APPROVER"], { id: "approver-1" });
    const viewer = user(["VIEWER"], { id: "viewer-1" });
    const inactiveAdmin = user(["ADMIN"], { id: "admin-2", active: false });

    // Non-admins and inactive admins are refused (fail closed)
    await expect(revealSupplierBankAccount("sup-100", staff)).rejects.toThrow(ForbiddenError);
    await expect(revealSupplierBankAccount("sup-100", approver)).rejects.toThrow(ForbiddenError);
    await expect(revealSupplierBankAccount("sup-100", viewer)).rejects.toThrow(ForbiddenError);
    await expect(revealSupplierBankAccount("sup-100", inactiveAdmin)).rejects.toThrow(ForbiddenError);

    // Active Admin receives full number via reveal
    const fullNumber = await revealSupplierBankAccount("sup-100", admin);
    expect(fullNumber).toBe("998877665544");
  });
});

describe("3. Non-Admin edit denied & safe saves", () => {
  beforeEach(() => {
    fake.state.suppliers = [
      {
        id: "sup-200",
        name: "Existing Hardware",
        tin: "222-333-444-000",
        taxType: "VAT",
        defaultTerms: "30 days",
        bankAccountName: "Existing HW Inc",
        bankAccountNumber: "112233445566",
        bankBranch: "Makati",
        bankNotes: "Keep intact",
        notes: "Some notes",
      },
    ];
    fake.state.audits = [];
  });

  it("refuses non-Admin creating a supplier with bank details", async () => {
    const staff = user(["STAFF"]);
    const newWithBank = {
      name: "New Supplier",
      tin: null,
      taxType: "VAT" as const,
      defaultTerms: null,
      bankAccountName: "New Bank",
      bankAccountNumber: "999988887777",
      bankBranch: "Quezon City",
      bankNotes: null,
      notes: null,
    };

    await expect(saveSupplier(null, newWithBank, staff)).rejects.toThrow(CompanyRuleError);
    await expect(saveSupplier(null, newWithBank, staff)).rejects.toThrow(/Only an Admin can add or edit bank details/);
  });

  it("refuses non-Admin altering existing bank details", async () => {
    const staff = user(["STAFF"]);
    const altered = {
      name: "Existing Hardware",
      tin: "222-333-444-000",
      taxType: "VAT" as const,
      defaultTerms: "30 days",
      bankAccountName: "Existing HW Inc",
      bankAccountNumber: "999999999999", // changed
      bankBranch: "Makati",
      bankNotes: "Keep intact",
      notes: "Some notes",
    };

    await expect(saveSupplier("sup-200", altered, staff)).rejects.toThrow(CompanyRuleError);
  });

  it("allows non-Admin updating other supplier fields without wiping bank details", async () => {
    const staff = user(["STAFF"]);
    // Non-Admin form submission has bank fields as null/omitted
    const nonAdminUpdate = {
      name: "Existing Hardware Renamed",
      tin: "222-333-444-000",
      taxType: "VAT" as const,
      defaultTerms: "60 days",
      bankAccountName: null,
      bankAccountNumber: null,
      bankBranch: null,
      bankNotes: null,
      notes: "Updated by staff",
    };

    const saved = await saveSupplier("sup-200", nonAdminUpdate, staff);
    expect(saved.name).toBe("Existing Hardware Renamed");
    expect(saved.defaultTerms).toBe("60 days");
    // Existing bank details MUST NOT be wiped
    expect(saved.bankAccountName).toBe("Existing HW Inc");
    expect(saved.bankAccountNumber).toBe("112233445566");
    expect(saved.bankBranch).toBe("Makati");
    expect(saved.bankNotes).toBe("Keep intact");
  });

  it("keeps the stored number when an Admin saves a blank or masked value", async () => {
    const admin = user(["ADMIN"]);
    const base = {
      name: "Existing Hardware",
      tin: "222-333-444-000",
      taxType: "VAT" as const,
      defaultTerms: "30 days",
      bankAccountName: "Existing HW Inc",
      bankBranch: "Makati",
      bankNotes: "Keep intact",
      notes: "Some notes",
    };

    const blank = await saveSupplier("sup-200", { ...base, bankAccountNumber: null }, admin);
    expect(blank.bankAccountNumber).toBe("112233445566");

    const masked = await saveSupplier("sup-200", { ...base, bankAccountNumber: "•••• 5566" }, admin);
    expect(masked.bankAccountNumber).toBe("112233445566");
    expect(JSON.stringify(fake.state.audits)).not.toContain("112233445566");
  });

  it("allows Admin to update bank details", async () => {
    const admin = user(["ADMIN"]);
    const adminUpdate = {
      name: "Existing Hardware",
      tin: "222-333-444-000",
      taxType: "VAT" as const,
      defaultTerms: "30 days",
      bankAccountName: "New HW Name",
      bankAccountNumber: "777788889999",
      bankBranch: "BGC",
      bankNotes: "Updated bank notes",
      notes: "Some notes",
    };

    const saved = await saveSupplier("sup-200", adminUpdate, admin);
    expect(saved.bankAccountNumber).toBe("777788889999");
    expect(saved.bankBranch).toBe("BGC");
  });
});

describe("4. Audit entries contain no full number", () => {
  beforeEach(() => {
    fake.state.suppliers = [
      {
        id: "sup-300",
        name: "Security Supply Co",
        tin: "555-666-777-000",
        taxType: "VAT",
        defaultTerms: null,
        bankAccountName: "Security Co",
        bankAccountNumber: "123456789012",
        bankBranch: "Ortigas",
        bankNotes: null,
        notes: null,
      },
    ];
    fake.state.audits = [];
  });

  it("records old last 4 -> new last 4 during bank detail edit, never full number", async () => {
    const admin = user(["ADMIN"], { id: "admin-audit-1" });
    const updateInput = {
      name: "Security Supply Co",
      tin: "555-666-777-000",
      taxType: "VAT" as const,
      defaultTerms: null,
      bankAccountName: "Security Co",
      bankAccountNumber: "987654321098", // changed
      bankBranch: "Ortigas",
      bankNotes: null,
      notes: null,
    };

    await saveSupplier("sup-300", updateInput, admin);

    expect(fake.state.audits).toHaveLength(1);
    const audit = fake.state.audits[0]!;
    expect(audit.action).toBe("update");
    expect(audit.entityType).toBe("Supplier");
    expect(audit.entityId).toBe("sup-300");

    const before = audit.before as Record<string, unknown>;
    const after = audit.after as Record<string, unknown>;

    expect(before.bankAccountNumber).toBe("•••• 9012");
    expect(after.bankAccountNumber).toBe("•••• 1098");

    // Full numbers MUST NOT appear anywhere in the audit payload
    const auditStr = JSON.stringify(audit);
    expect(auditStr).not.toContain("123456789012");
    expect(auditStr).not.toContain("987654321098");
  });

  it("records 'viewed bank number' with last 4 only when Admin reveals full number", async () => {
    const admin = user(["ADMIN"], { id: "admin-audit-2" });
    await revealSupplierBankAccount("sup-300", admin);

    expect(fake.state.audits).toHaveLength(1);
    const audit = fake.state.audits[0]!;
    expect(audit.userId).toBe("admin-audit-2");
    expect(audit.entityType).toBe("Supplier");
    expect(audit.entityId).toBe("sup-300");

    const after = audit.after as Record<string, unknown>;
    expect(after.action).toBe("viewed bank number");
    expect(after.last4).toBe("9012");
    expect(after.bankAccountNumber).toBe("•••• 9012");

    // Full number MUST NOT appear in the audit record
    const auditStr = JSON.stringify(audit);
    expect(auditStr).not.toContain("123456789012");
  });

  it("auditDiff automatically masks bankAccountNumber if raw numbers are passed", () => {
    const diff = auditDiff(
      { bankAccountNumber: "1111222233334444" },
      { bankAccountNumber: "5555666677778888" },
    );
    expect(diff.before?.bankAccountNumber).toBe("•••• 4444");
    expect(diff.after?.bankAccountNumber).toBe("•••• 8888");
    const diffStr = JSON.stringify(diff);
    expect(diffStr).not.toContain("1111222233334444");
    expect(diffStr).not.toContain("5555666677778888");
  });

  it("writeAudit diff:false sanitizes raw bankAccountNumber", async () => {
    const client = fake.client as unknown as Db;
    fake.state.audits = [];
    await writeAudit(client, {
      userId: "u1",
      entityType: "Supplier",
      entityId: "sup-999",
      action: "download",
      after: {
        bankAccountNumber: "0000111122223333",
        note: "viewed",
      },
      diff: false,
    });

    expect(fake.state.audits).toHaveLength(1);
    const recorded = fake.state.audits[0]!;
    const after = recorded.after as Record<string, unknown>;
    expect(after.bankAccountNumber).toBe("•••• 3333");
    expect(JSON.stringify(recorded)).not.toContain("0000111122223333");
  });
});

describe("5. Server actions fail closed", () => {
  beforeEach(() => {
    fake.state.suppliers = [
      {
        id: "sup-action-1",
        name: "Action Supplier",
        tin: null,
        taxType: "VAT",
        defaultTerms: null,
        bankAccountName: "Original Bank",
        bankAccountNumber: "555566667777",
        bankBranch: "Ortigas",
        bankNotes: "Original notes",
        notes: null,
      },
    ];
    fake.state.audits = [];
  });

  it("saveSupplierAction refuses non-Admin submitting bank fields", async () => {
    fake.state.currentUser = user(["STAFF"], { id: "staff-action-user" });

    const form = new FormData();
    form.append("name", "Action Supplier");
    form.append("taxType", "VAT");
    form.append("bankAccountNumber", "123412341234");

    const result = await saveSupplierAction("sup-action-1", {}, form);
    expect(result.ok).toBeFalsy();
    expect(result.fieldErrors?.bankAccountNumber || result.message).toMatch(/Only an Admin can add or edit bank details/);
  });

  it("saveSupplierAction preserves bank fields when non-Admin saves other fields", async () => {
    fake.state.currentUser = user(["STAFF"], { id: "staff-action-user" });

    const form = new FormData();
    form.append("name", "Action Supplier Renamed");
    form.append("taxType", "VAT");

    const result = await saveSupplierAction("sup-action-1", {}, form);
    expect(result.ok).toBe(true);

    const updated = fake.state.suppliers.find((s) => s.id === "sup-action-1");
    expect(updated?.name).toBe("Action Supplier Renamed");
    expect(updated?.bankAccountName).toBe("Original Bank");
    expect(updated?.bankAccountNumber).toBe("555566667777");
  });

  it("revealSupplierBankAccountAction fails closed for non-Admin", async () => {
    fake.state.currentUser = user(["STAFF"], { id: "staff-action-user" });

    const result = await revealSupplierBankAccountAction("sup-action-1");
    expect(result.ok).toBe(false);
    expect(result.bankAccountNumber).toBeUndefined();
  });

  it("revealSupplierBankAccountAction succeeds for Admin and logs audit", async () => {
    fake.state.currentUser = user(["ADMIN"], { id: "admin-action-user" });

    const result = await revealSupplierBankAccountAction("sup-action-1");
    expect(result.ok).toBe(true);
    expect(result.bankAccountNumber).toBe("555566667777");

    expect(fake.state.audits).toHaveLength(1);
    const audit = fake.state.audits[0]!;
    expect(audit.userId).toBe("admin-action-user");
    const after = audit.after as Record<string, unknown>;
    expect(after.action).toBe("viewed bank number");
    expect(after.last4).toBe("7777");
    expect(JSON.stringify(audit)).not.toContain("555566667777");
  });

  it("saveSupplierAction keeps the stored number when an Admin leaves the field blank", async () => {
    fake.state.currentUser = user(["ADMIN"], { id: "admin-keep" });

    const form = new FormData();
    form.append("name", "Action Supplier");
    form.append("taxType", "VAT");
    form.append("bankAccountName", "Original Bank");
    form.append("bankAccountNumber", "");
    form.append("bankBranch", "Ortigas");
    form.append("bankNotes", "Original notes");

    const result = await saveSupplierAction("sup-action-1", {}, form);
    expect(result.ok).toBe(true);

    const updated = fake.state.suppliers.find((s) => s.id === "sup-action-1");
    expect(updated?.bankAccountNumber).toBe("555566667777");
    expect(JSON.stringify(fake.state.audits)).not.toContain("555566667777");
  });
});

describe("6. Activity display and outbound surfaces never include the full number", () => {
  const FULL = "998877665544";

  it("activity label and diff hide a raw number", () => {
    const label = bankViewActivityLabel({
      action: "viewed bank number",
      bankAccountNumber: FULL,
      last4: "5544",
    });
    expect(label).toBe("viewed bank number");
    expect(label).not.toContain(FULL);

    const masked = bankViewActivityLabel({
      action: "viewed bank number",
      bankAccountNumber: "•••• 5544",
      last4: "5544",
    });
    expect(masked).toBe("viewed bank number •••• 5544");
    expect(masked).not.toContain(FULL);

    expect(auditDisplayValue("bankAccountNumber", FULL)).toBe("•••• 5544");
    expect(String(auditDisplayValue("bankAccountNumber", FULL))).not.toContain("9988");
    expect(auditDisplayValue("name", "Acme")).toBe("Acme");
  });

  function walk(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, acc);
      else if (/\.(ts|tsx|mjs)$/.test(name)) acc.push(p);
    }
    return acc;
  }

  it("print, csv, export, and search routes do not reference supplier bank account numbers", () => {
    const files = [
      ...walk("src/app/print"),
      ...walk("src/app/(app)/books"),
      ...walk("src/app/(app)/cash"),
      "src/lib/print/views.ts",
      "src/lib/purchasing/views.ts",
      "src/lib/payables/views.ts",
      "src/lib/quotes/views.ts",
      "src/lib/services/expenses.ts",
    ];
    const hits = files.filter((f) => readFileSync(f, "utf8").includes("bankAccountNumber"));
    expect(hits).toEqual([]);

    const routeHits = walk("src/app").filter(
      (f) => f.endsWith("route.ts") && readFileSync(f, "utf8").includes("bankAccountNumber"),
    );
    expect(routeHits).toEqual([]);

    const listSrc = readFileSync("src/lib/services/companies.ts", "utf8");
    const listFn = listSrc.slice(listSrc.indexOf("export function listSuppliers"), listSrc.indexOf("export function getSupplier"));
    expect(listFn).not.toContain("bankAccount");
    expect(listFn).toContain("name: { contains: q }");
    expect(listFn).toContain("tin: { contains:");
  });

  it("the supplier page and edit form do not preload the full number for an Admin", () => {
    const page = readFileSync("src/app/(app)/suppliers/[id]/page.tsx", "utf8");
    expect(page).not.toContain("user.isAdmin ? supplier");
    expect(page).toContain("maskSupplierForViewer");
    const form = readFileSync("src/app/(app)/suppliers/SupplierForm.tsx", "utf8");
    expect(form).toContain("bankNumberDraft");
    expect(form).not.toContain('useState(v("bankAccountNumber"))');
  });
});

