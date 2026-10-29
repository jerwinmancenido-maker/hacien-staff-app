// Service rules that need the database, run against a small in-memory fake of
// the Prisma client (no MySQL needed).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

type Row = Record<string, unknown> & { id: string };

const fake = vi.hoisted(() => {
  process.env.SESSION_SECRET ??= "test-secret-at-least-16-chars";
  const state = {
    tokens: [] as Row[],
    suppliers: [] as Row[],
    users: [] as Row[],
    audits: [] as Row[],
    sent: [] as { to: string; text: string }[],
    /** Simulates a concurrent insert winning the race on a unique index. */
    raceOnCreate: false,
    uniqueViolation: (): Error => new Error("set below"),
    n: 0,
  };
  const id = () => `id${++state.n}`;
  const matches = (row: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([k, v]) => (k === "NOT" ? !matches(row, v as Record<string, unknown>) : row[k] === v));
  const table = (rows: () => Row[], name: string, defaults: Record<string, unknown> = {}) => ({
    async findFirst({ where }: { where: Record<string, unknown> }) {
      return rows().find((r) => matches(r, where)) ?? null;
    },
    async findUnique({ where, include }: { where: Record<string, unknown>; include?: { user?: boolean } }) {
      const r = rows().find((x) => matches(x, where));
      if (!r) return null;
      return include?.user ? { ...r, user: state.users.find((u) => u.id === r.userId) } : r;
    },
    async findUniqueOrThrow({ where }: { where: Record<string, unknown> }) {
      const r = rows().find((x) => matches(x, where));
      if (!r) throw new Error("not found");
      return r;
    },
    async create({ data }: { data: Record<string, unknown> }) {
      if (state.raceOnCreate) throw state.uniqueViolation();
      const row = { id: id(), createdAt: new Date(), ...defaults, ...data } as Row;
      rows().push(row);
      return row;
    },
    async update({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      const r = rows().find((x) => matches(x, where));
      if (!r) throw new Error(`${name} not found`);
      Object.assign(r, data);
      return r;
    },
    async updateMany({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      const hit = rows().filter((x) => matches(x, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
  });
  const client: Record<string, unknown> = {
    passwordResetToken: table(() => state.tokens, "token", { usedAt: null }),
    supplier: table(() => state.suppliers, "supplier"),
    user: table(() => state.users, "user", { active: true }),
    auditLog: table(() => state.audits, "audit"),
    async $transaction(fn: (tx: unknown) => Promise<unknown>) {
      return fn(client);
    },
  };
  return { state, client };
});

vi.mock("@/lib/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/db")>()), db: fake.client }));
vi.mock("@/lib/mailer", () => ({
  appUrl: (p: string) => `http://test${p}`,
  getMailer: () => ({ send: async (m: { to: string; text: string }) => void fake.state.sent.push(m) }),
}));

fake.state.uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });

const { createUser, DUPLICATE_EMAIL, findValidToken, issueToken, requestPasswordReset, UserRuleError } = await import("@/lib/services/users");
const { saveSupplier, CompanyRuleError } = await import("@/lib/services/companies");
const { db } = await import("@/lib/db");
type Tx = Parameters<typeof issueToken>[0];

beforeEach(() => {
  Object.assign(fake.state, { tokens: [], suppliers: [], users: [], audits: [], sent: [], raceOnCreate: false });
});

const tokenFromMail = () => new URL(fake.state.sent.at(-1)!.text.match(/http:\/\/test\S+/)![0]).searchParams.get("token")!;

describe("password reset links", () => {
  it("issuing a new reset link invalidates older unused ones", async () => {
    fake.state.users.push({ id: "u1", email: "ana@example.com", name: "Ana", active: true });
    await requestPasswordReset("ana@example.com");
    const first = tokenFromMail();
    await requestPasswordReset("ana@example.com");
    const second = tokenFromMail();
    expect(first).not.toBe(second);
    expect(fake.state.tokens).toHaveLength(2); // kept, never deleted
    expect(await findValidToken(first)).toBeNull();
    expect((await findValidToken(second))?.userId).toBe("u1");
  });

  it("only cancels unused links of the same kind for the same user", async () => {
    const tx = db as unknown as Tx;
    const now = new Date("2026-10-30T00:00:00Z");
    const invite = await issueToken(tx, "u1", "INVITE", now);
    await issueToken(tx, "u2", "RESET", now);
    await issueToken(tx, "u1", "RESET", now);
    const later = new Date(now.getTime() + 1000);
    await issueToken(tx, "u1", "RESET", later);
    const byUserPurpose = (u: string, p: string) => fake.state.tokens.filter((t) => t.userId === u && t.purpose === p);
    expect(byUserPurpose("u1", "RESET").map((t) => t.usedAt)).toEqual([later, null]);
    expect(byUserPurpose("u2", "RESET")[0]!.usedAt).toBeNull();
    expect(byUserPurpose("u1", "INVITE")[0]!.usedAt).toBeNull();
    expect(invite).toBeTruthy();
  });
});

describe("supplier TIN", () => {
  const input = (name: string, tin: string | null) =>
    ({ name, tin, address: null, taxType: "VAT", defaultTerms: null, bankAccountName: null, bankAccountNumber: null, bankBranch: null, bankNotes: null, notes: null }) as Parameters<typeof saveSupplier>[1];

  it("is unique among suppliers with the same friendly message as customers", async () => {
    const uno = await saveSupplier(null, input("UNO Computer Supply", "000-777-888-000"), "admin");
    const err = await saveSupplier(null, input("Copycat Trading", "000-777-888-000"), "admin").catch((e) => e);
    expect(err).toBeInstanceOf(CompanyRuleError);
    expect(err).toMatchObject({ message: "This TIN belongs to UNO Computer Supply.", field: "tin" });
    // Saving the same supplier again with its own TIN is fine; so are suppliers without a TIN.
    await expect(saveSupplier(uno.id, input("UNO Computer Supply Inc.", "000-777-888-000"), "admin")).resolves.toBeTruthy();
    await saveSupplier(null, input("Gilmore Street Seller", null), "admin");
    await expect(saveSupplier(null, input("Another Seller", null), "admin")).resolves.toBeTruthy();
  });

  it("turns a unique-index race into the same friendly message", async () => {
    // The pre-check passes, then a concurrent save inserts the TIN first.
    let calls = 0;
    const findFirst = fake.client.supplier as { findFirst: (a: unknown) => Promise<unknown> };
    const original = findFirst.findFirst;
    findFirst.findFirst = async () => (++calls === 1 ? null : { id: "other", name: "Metro IT Parts" });
    fake.state.raceOnCreate = true;
    try {
      const err = await saveSupplier(null, input("Late Saver", "000-999-000-000"), "admin").catch((e) => e);
      expect(err).toMatchObject({ message: "This TIN belongs to Metro IT Parts.", field: "tin" });
    } finally {
      findFirst.findFirst = original;
    }
  });
});

describe("createUser duplicate email", () => {
  const input = { name: "Maria", email: "maria@example.com", roles: ["STAFF" as const], canSeeCosts: false } as Parameters<typeof createUser>[0];

  it("is checked inside the transaction with a friendly error", async () => {
    await createUser(input, "admin");
    const err = await createUser(input, "admin").catch((e) => e);
    expect(err).toBeInstanceOf(UserRuleError);
    expect(err.message).toBe(DUPLICATE_EMAIL);
    expect(fake.state.users).toHaveLength(1);
  });

  it("turns a unique-index race (P2002) into the same friendly error", async () => {
    fake.state.raceOnCreate = true;
    const err = await createUser(input, "admin").catch((e) => e);
    expect(err).toBeInstanceOf(UserRuleError);
    expect(err.message).toBe(DUPLICATE_EMAIL);
    expect(fake.state.sent).toHaveLength(0);
  });
});
