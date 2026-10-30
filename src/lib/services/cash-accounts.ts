// Cash / bank accounts (hand-recorded). Running balance is computed, never stored.

import { db, type Tx } from "../db";
import { writeAudit } from "../audit";
import { assertCan, type PermissionUser } from "../permissions";
import { assertCashEnabled } from "../cash/features";
import { DocRuleError, DOC_TX, money, withTxRetry, ymd } from "../documents/common";
import { fromScaled, toScaled } from "../quotes/calc";
import { accountBalanceAsOf, type LedgerSourceRow } from "../cash/balance";
import type { CashAccountInput } from "../validation/cash";

export type CashActor = PermissionUser & { id: string };

function assertManageCash(actor: CashActor) {
  assertCan(actor, "manage_cash");
}

export async function listActiveCashAccounts() {
  return db.cashAccount.findMany({
    where: { active: true },
    orderBy: [{ name: "asc" }],
  });
}

export async function listCashAccounts(includeInactive = false) {
  return db.cashAccount.findMany({
    where: includeInactive ? undefined : { active: true },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

/** Most recently used cash account across collections, payments, expenses — or the only active one. */
export async function defaultCashAccountId(): Promise<string | null> {
  const active = await listActiveCashAccounts();
  if (active.length === 0) return null;
  if (active.length === 1) return active[0]!.id;

  const [c, p, e] = await Promise.all([
    db.collection.findFirst({
      where: { cashAccountId: { not: null }, status: "POSTED" },
      orderBy: { createdAt: "desc" },
      select: { cashAccountId: true, createdAt: true },
    }),
    db.supplierPayment.findFirst({
      where: { cashAccountId: { not: null }, status: "POSTED" },
      orderBy: { createdAt: "desc" },
      select: { cashAccountId: true, createdAt: true },
    }),
    db.expense.findFirst({
      where: { status: "POSTED" },
      orderBy: { createdAt: "desc" },
      select: { cashAccountId: true, createdAt: true },
    }),
  ]);
  const candidates = [c, p, e].filter(Boolean) as { cashAccountId: string | null; createdAt: Date }[];
  candidates.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const id = candidates[0]?.cashAccountId;
  if (id && active.some((a) => a.id === id)) return id;
  return active[0]!.id;
}

export async function createCashAccount(input: CashAccountInput, actor: CashActor) {
  assertManageCash(actor);
  await assertCashEnabled();
  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      const row = await tx.cashAccount.create({
        data: {
          name: input.name,
          type: input.type,
          bankName: input.bankName,
          accountHintLast4: input.accountHintLast4,
          openingBalance: input.openingBalance,
          openingDate: input.openingDate,
          active: input.active,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "CashAccount",
        entityId: row.id,
        action: "create",
        after: {
          name: row.name,
          type: row.type,
          bankName: row.bankName,
          accountHintLast4: row.accountHintLast4,
          openingBalance: money(row.openingBalance),
          openingDate: ymd(row.openingDate),
          active: row.active,
        },
      });
      return row;
    }, DOC_TX),
  );
}

export async function updateCashAccount(id: string, input: CashAccountInput, actor: CashActor) {
  assertManageCash(actor);
  await assertCashEnabled();
  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT \`id\` FROM \`CashAccount\` WHERE \`id\` = ${id} FOR UPDATE`;
      const before = await tx.cashAccount.findUnique({ where: { id } });
      if (!before) throw new DocRuleError("Cash account not found.");

      // Opening balance/date only editable when no posted activity is linked.
      const activity = await accountActivityCount(tx, id);
      if (activity > 0) {
        if (money(before.openingBalance) !== input.openingBalance || ymd(before.openingDate) !== ymd(input.openingDate)) {
          throw new DocRuleError(
            "Opening balance can't change after collections, payments, expenses or transfers are linked. Void those first, or record a transfer to adjust.",
            "openingBalance",
          );
        }
      }

      const after = await tx.cashAccount.update({
        where: { id },
        data: {
          name: input.name,
          type: input.type,
          bankName: input.bankName,
          accountHintLast4: input.accountHintLast4,
          openingBalance: input.openingBalance,
          openingDate: input.openingDate,
          active: input.active,
          archivedAt: input.active ? null : before.archivedAt ?? new Date(),
          updatedById: actor.id,
        },
      });
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "CashAccount",
        entityId: id,
        action: input.active === before.active ? "update" : input.active ? "restore" : "archive",
        before: {
          name: before.name,
          type: before.type,
          bankName: before.bankName,
          accountHintLast4: before.accountHintLast4,
          openingBalance: money(before.openingBalance),
          openingDate: ymd(before.openingDate),
          active: before.active,
        },
        after: {
          name: after.name,
          type: after.type,
          bankName: after.bankName,
          accountHintLast4: after.accountHintLast4,
          openingBalance: money(after.openingBalance),
          openingDate: ymd(after.openingDate),
          active: after.active,
        },
      });
      return after;
    }, DOC_TX),
  );
}

/** Non-void activity linked to this account. Voided rows do not lock opening balance. */
async function accountActivityCount(tx: Tx, id: string) {
  const [c, p, e, tFrom, tTo] = await Promise.all([
    tx.collection.count({ where: { cashAccountId: id, status: "POSTED" } }),
    tx.supplierPayment.count({ where: { cashAccountId: id, status: "POSTED" } }),
    tx.expense.count({ where: { cashAccountId: id, status: "POSTED" } }),
    tx.cashTransfer.count({ where: { fromAccountId: id, status: "POSTED" } }),
    tx.cashTransfer.count({ where: { toAccountId: id, status: "POSTED" } }),
  ]);
  return c + p + e + tFrom + tTo;
}

/** Ledger source rows for one account (voided flagged, still returned for display filters). */
export async function ledgerEntriesForAccount(accountId: string): Promise<LedgerSourceRow[]> {
  const [collections, payments, expenses, transfersFrom, transfersTo] = await Promise.all([
    db.collection.findMany({
      where: { cashAccountId: accountId },
      include: { customer: { select: { name: true } } },
      orderBy: { date: "asc" },
    }),
    db.supplierPayment.findMany({
      where: { cashAccountId: accountId },
      include: { supplier: { select: { name: true } } },
      orderBy: { date: "asc" },
    }),
    db.expense.findMany({
      where: { cashAccountId: accountId },
      include: { category: { select: { label: true } }, supplier: { select: { name: true } } },
      orderBy: { date: "asc" },
    }),
    db.cashTransfer.findMany({
      where: { fromAccountId: accountId },
      include: { toAccount: { select: { name: true } } },
      orderBy: { date: "asc" },
    }),
    db.cashTransfer.findMany({
      where: { toAccountId: accountId },
      include: { fromAccount: { select: { name: true } } },
      orderBy: { date: "asc" },
    }),
  ]);

  const rows: LedgerSourceRow[] = [];

  for (const c of collections) {
    rows.push({
      id: c.id,
      kind: "COLLECTION",
      number: c.number,
      date: ymd(c.date)!,
      amount: money(c.amountReceived),
      direction: "IN",
      voided: c.status === "VOID",
      description: `Collection · ${c.customer.name}`,
      href: `/billing/collections/${c.id}`,
    });
  }
  for (const p of payments) {
    rows.push({
      id: p.id,
      kind: "SUPPLIER_PAYMENT",
      number: p.number,
      date: ymd(p.date)!,
      amount: money(p.amountPaid),
      direction: "OUT",
      voided: p.status === "VOID",
      description: `Supplier payment · ${p.supplier.name}`,
      href: `/payables/payments/${p.id}`,
    });
  }
  for (const e of expenses) {
    const payee = e.supplier?.name ?? e.payeeText ?? "Payee";
    rows.push({
      id: e.id,
      kind: "EXPENSE",
      number: e.number,
      date: ymd(e.date)!,
      amount: money(e.amount),
      direction: "OUT",
      voided: e.status === "VOID",
      description: `Expense · ${e.category.label} · ${payee}`,
      href: `/cash/expenses/${e.id}`,
    });
  }
  for (const t of transfersFrom) {
    rows.push({
      id: `${t.id}:out`,
      kind: "TRANSFER",
      number: t.number,
      date: ymd(t.date)!,
      amount: money(t.amount),
      direction: "TRANSFER_OUT",
      voided: t.status === "VOID",
      description: `Transfer to ${t.toAccount.name}`,
      href: `/cash/transfers/${t.id}`,
    });
  }
  for (const t of transfersTo) {
    rows.push({
      id: `${t.id}:in`,
      kind: "TRANSFER",
      number: t.number,
      date: ymd(t.date)!,
      amount: money(t.amount),
      direction: "TRANSFER_IN",
      voided: t.status === "VOID",
      description: `Transfer from ${t.fromAccount.name}`,
      href: `/cash/transfers/${t.id}`,
    });
  }
  return rows;
}

export async function cashAccountBalance(accountId: string, asOfYmd?: string | null): Promise<string> {
  const account = await db.cashAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new DocRuleError("Cash account not found.");
  const entries = await ledgerEntriesForAccount(accountId);
  return accountBalanceAsOf(money(account.openingBalance), ymd(account.openingDate)!, entries, asOfYmd);
}

/** Dashboard / overview: balance per account + unassigned net. */
export async function cashPositionSummary() {
  const accounts = await listCashAccounts(true);
  const active = accounts.filter((a) => a.active);
  const rows = await Promise.all(
    active.map(async (a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      bankName: a.bankName,
      accountHintLast4: a.accountHintLast4,
      balance: await cashAccountBalance(a.id),
      href: `/cash/accounts/${a.id}`,
    })),
  );

  const [unassignedIn, unassignedOut] = await Promise.all([
    db.collection.findMany({
      where: { cashAccountId: null, status: "POSTED" },
      select: { amountReceived: true },
    }),
    db.supplierPayment.findMany({
      where: { cashAccountId: null, status: "POSTED" },
      select: { amountPaid: true },
    }),
  ]);
  const unassignedNet = fromScaled(
    unassignedIn.reduce((a, x) => a + toScaled(money(x.amountReceived), 2), 0n) -
      unassignedOut.reduce((a, x) => a + toScaled(money(x.amountPaid), 2), 0n),
    2,
  );
  const total = fromScaled(
    rows.reduce((a, r) => a + toScaled(r.balance, 2), 0n) + toScaled(unassignedNet, 2),
    2,
  );
  return { accounts: rows, unassignedNet, total };
}
