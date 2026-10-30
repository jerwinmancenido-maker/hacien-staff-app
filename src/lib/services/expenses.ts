// Expenses (EXP-YYYY-####): hand-recorded company spending. No VAT input tax.
// Optional withholdingApplied mirrors Part 6 EWT (cash leaving the account is amount only).

import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { writeAudit } from "../audit";
import { assertCan, type PermissionUser } from "../permissions";
import { getSettingsSnapshot } from "../settings";
import { allocateDocNumber, ensureSeries } from "../documents/series";
import { DocRuleError, DOC_TX, money, withTxRetry, ymd } from "../documents/common";
import { toScaled } from "../quotes/calc";
import type { ExpenseInput } from "../validation/cash";
import { createAttachments, discardUploads, prepareUploads, type UploadFile } from "./attachments";

export type ExpenseActor = PermissionUser & { id: string };

function assertManageCash(actor: ExpenseActor) {
  assertCan(actor, "manage_cash");
}

export async function listExpenseCategories(activeOnly = true) {
  return db.expenseCategory.findMany({
    where: activeOnly ? { active: true } : undefined,
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
}

/** Last used expense category, else the first active one. */
export async function defaultExpenseCategoryId(): Promise<string | null> {
  const cats = await listExpenseCategories(true);
  if (!cats.length) return null;
  const last = await db.expense.findFirst({
    where: { status: "POSTED" },
    orderBy: { createdAt: "desc" },
    select: { categoryId: true },
  });
  if (last && cats.some((c) => c.id === last.categoryId)) return last.categoryId;
  return cats[0]!.id;
}

export async function listExpenses(filters: { status?: "POSTED" | "VOID" | "ALL"; q?: string; cashAccountId?: string } = {}) {
  const where: {
    status?: "POSTED" | "VOID";
    cashAccountId?: string;
    OR?: (
      | { number: { contains: string } }
      | { payeeText: { contains: string } }
      | { supplier: { name: { contains: string } } }
      | { receiptNo: { contains: string } }
    )[];
  } = {};
  if (filters.status && filters.status !== "ALL") where.status = filters.status;
  if (filters.cashAccountId) where.cashAccountId = filters.cashAccountId;
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    where.OR = [
      { number: { contains: q } },
      { payeeText: { contains: q } },
      { supplier: { name: { contains: q } } },
      { receiptNo: { contains: q } },
    ];
  }
  return db.expense.findMany({
    where,
    include: {
      category: { select: { id: true, label: true, code: true } },
      cashAccount: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
}

export async function getExpense(id: string) {
  return db.expense.findUnique({
    where: { id },
    include: {
      category: true,
      cashAccount: true,
      supplier: { select: { id: true, name: true } },
      attachments: { where: { archivedAt: null }, orderBy: { createdAt: "asc" } },
      createdBy: { select: { id: true, name: true } },
    },
  });
}

export async function recordExpense(input: ExpenseInput, actor: ExpenseActor, files: readonly UploadFile[] = []) {
  assertManageCash(actor);
  if (toScaled(input.amount, 2) <= 0n) throw new DocRuleError("Amount must be greater than 0.", "amount");
  if (toScaled(input.withholdingApplied, 2) < 0n) {
    throw new DocRuleError("Withholding can't be negative.", "withholdingApplied");
  }

  const snap = await getSettingsSnapshot();
  const format = snap.settings.numbering.expense;
  const year = input.date.getUTCFullYear();
  await ensureSeries(db, "EXPENSE", year, format);
  const uploads = await prepareUploads(files);

  try {
    return await withTxRetry(() =>
      db.$transaction(async (tx) => {
        const account = await tx.cashAccount.findUnique({ where: { id: input.cashAccountId } });
        if (!account || !account.active) {
          throw new DocRuleError("Pick an active cash account. Add one under Cash → Accounts first.", "cashAccountId");
        }
        const category = await tx.expenseCategory.findUnique({ where: { id: input.categoryId } });
        if (!category || !category.active) {
          throw new DocRuleError("Pick an active expense category.", "categoryId");
        }
        if (input.supplierId) {
          const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
          if (!supplier) throw new DocRuleError("That supplier was not found. Pick another or type a payee name.", "supplierId");
        }

        const number = await allocateDocNumber(tx, "EXPENSE", year, format);
        const expense = await tx.expense.create({
          data: {
            number,
            date: input.date,
            supplierId: input.supplierId,
            payeeText: input.supplierId ? null : input.payeeText,
            categoryId: input.categoryId,
            amount: input.amount,
            withholdingApplied: input.withholdingApplied,
            cashAccountId: input.cashAccountId,
            receiptNo: input.receiptNo,
            notes: input.notes,
            createdById: actor.id,
          },
        });
        await createAttachments(tx, uploads, { expenseId: expense.id }, actor.id);
        await writeAudit(tx, {
          userId: actor.id,
          entityType: "Expense",
          entityId: expense.id,
          action: "create",
          after: {
            number,
            date: ymd(input.date),
            payee: input.supplierId ?? input.payeeText,
            category: category.label,
            amount: input.amount,
            withholdingApplied: input.withholdingApplied,
            cashAccount: account.name,
            receiptNo: input.receiptNo,
            attachments: uploads.length,
          },
        });
        return expense;
      }, DOC_TX),
    );
  } catch (e) {
    await discardUploads(uploads);
    throw e;
  }
}

export async function voidExpense(id: string, reason: string, actor: ExpenseActor) {
  assertManageCash(actor);
  const why = reason.trim();
  if (!why) throw new DocRuleError("A reason is required.", "reason");

  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT \`id\` FROM \`Expense\` WHERE \`id\` = ${id} FOR UPDATE`;
      const before = await tx.expense.findUnique({ where: { id } });
      if (!before) throw new DocRuleError("Expense not found.");
      if (before.status === "VOID") throw new DocRuleError("This expense is already void.");

      const now = new Date();
      const after = await tx.expense.update({
        where: { id },
        data: { status: "VOID", voidedAt: now, voidReason: why },
      });
      await tx.documentVoid.create({
        data: {
          docType: "EXPENSE",
          docNumber: before.number,
          docId: id,
          reason: why,
          snapshot: JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue,
          voidedById: actor.id,
          voidedAt: now,
        },
      });
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "Expense",
        entityId: id,
        action: "void",
        before: { status: "POSTED", amount: money(before.amount) },
        after: { status: "VOID", voidReason: why },
        diff: false,
      });
      return after;
    }, DOC_TX),
  );
}
