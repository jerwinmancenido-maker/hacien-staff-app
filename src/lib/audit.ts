// Audit log: who, when, what, and a before/after diff of changed fields only.
// Always call writeAudit with the transaction client used for the change itself.

import type { AuditAction, Prisma } from "@prisma/client";
import { currentApiAudit } from "./api/context";
import type { Tx, Db } from "./db";
import { maskBankAccountNumber } from "./bank-mask";

export type AuditEntityType =
  | "User"
  | "Customer"
  | "Supplier"
  | "Contact"
  | "Settings"
  | "Session"
  | "Quote"
  | "SalesOrder"
  | "Address"
  | "BusinessDocument"
  | "PurchaseOrder"
  | "ReceivingReport"
  | "SupplierReturn"
  | "CustomerReturn"
  | "SupplierBill"
  | "Delivery"
  | "DocumentAttachment"
  | "Billing"
  | "Collection"
  | "Withholding2307"
  | "Item"
  | "SupplierPayment"
  | "SupplierWithholding2307"
  | "CashAccount"
  | "Expense"
  | "CashTransfer"
  | "TaxPaidQuarter"
  | "TaxCalendarCompletion"
  | "SpoiledBookletNumber"
  | "StatementReminder"
  | "WarrantyClaim"
  | "PeriodLock"
  | "EmailSuppression";

type Plain = Record<string, unknown>;

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && "toFixed" in value) return String(value); // Decimal
  return value;
}

/** Value shown in the activity diff. Bank numbers are last-4 only. */
export function auditDisplayValue(key: string, value: unknown): unknown {
  if (key === "bankAccountNumber" && typeof value === "string") return maskBankAccountNumber(value);
  return value;
}

function sanitizeAuditPlain(obj: Plain | null | undefined): Plain | null {
  if (!obj) return null;
  const out: Plain = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "bankAccountNumber") {
      out[k] = typeof v === "string" ? maskBankAccountNumber(v) : v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Changed fields only. Ignores bookkeeping fields. For creates pass `before = null`,
 * which records every (non-empty) field as "after".
 * Bank account numbers are always masked (old last 4 -> new last 4).
 */
export function auditDiff(
  before: Plain | null | undefined,
  after: Plain | null | undefined,
): { before: Plain | null; after: Plain | null } {
  const ignore = new Set(["createdAt", "updatedAt", "passwordHash", "tokenHash"]);
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const b: Plain = {};
  const a: Plain = {};
  for (const key of keys) {
    if (ignore.has(key)) continue;
    // Missing and null count as the same (a create with tin: null has no tin change).
    let bv = normalize(before?.[key]) ?? null;
    let av = normalize(after?.[key]) ?? null;
    if (key === "bankAccountNumber") {
      if (typeof bv === "string") bv = maskBankAccountNumber(bv);
      if (typeof av === "string") av = maskBankAccountNumber(av);
    }
    if (JSON.stringify(bv) === JSON.stringify(av)) continue;
    if (before) b[key] = bv;
    if (after) a[key] = av;
  }
  return {
    before: before ? b : null,
    after: after ? a : null,
  };
}

export type AuditInput = {
  userId: string | null;
  entityType: AuditEntityType;
  entityId: string | null;
  action: AuditAction;
  before?: Plain | null;
  after?: Plain | null;
  ip?: string | null;
  /** Set by /api/v1 via the request context when omitted. Null for staff UI changes. */
  apiKeyId?: string | null;
  /** Pass false to store before/after as given (already a diff). */
  diff?: boolean;
};

export async function writeAudit(tx: Tx | Db, input: AuditInput): Promise<void> {
  const { before, after } =
    input.diff === false
      ? { before: sanitizeAuditPlain(input.before), after: sanitizeAuditPlain(input.after) }
      : auditDiff(input.before, input.after);
  // /api/v1 runs the existing services inside a request context so the audit
  // row records which key did it, without each service taking an apiKeyId.
  const viaApi = currentApiAudit();
  const apiKeyId = input.apiKeyId !== undefined ? input.apiKeyId : (viaApi?.apiKeyId ?? null);
  const ip = input.ip !== undefined ? input.ip : (viaApi?.ip ?? null);
  await tx.auditLog.create({
    data: {
      userId: input.userId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      before: (before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (after ?? undefined) as Prisma.InputJsonValue | undefined,
      ip,
      apiKeyId,
    },
  });
}
