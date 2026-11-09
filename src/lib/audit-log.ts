// S-84: the audit log, made readable. Rows show a plain sentence and the
// record's number or name (never a raw id), plus a link to the record.
// A deleted draft or void document stays in this log as "Deleted", with the
// snapshot from the audit row and no link to the removed page.

import type { AuditAction } from "@prisma/client";
import { db } from "./db";
import { stripCosts, type PermissionUser } from "./permissions";

export const AUDIT_ENTITIES = [
  "Quote",
  "SalesOrder",
  "PurchaseOrder",
  "Billing",
  "Collection",
  "SupplierBill",
  "ReceivingReport",
  "SupplierReturn",
  "SupplierPayment",
  "Expense",
  "CashTransfer",
  "CashAccount",
  "Customer",
  "Supplier",
  "Contact",
  "Address",
  "BusinessDocument",
  "DocumentAttachment",
  "Delivery",
  "User",
  "Settings",
  "Session",
  "TaxCalendarCompletion",
  "TaxPaidQuarter",
  "SpoiledBookletNumber",
  "EmailSuppression",
] as const;

export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  Quote: "Quote",
  SalesOrder: "Sales order",
  PurchaseOrder: "Purchase order",
  Billing: "Billing",
  Collection: "Collection",
  SupplierBill: "Supplier bill",
  ReceivingReport: "Receiving report",
  SupplierReturn: "Supplier return",
  SupplierPayment: "Supplier payment",
  Expense: "Expense",
  CashTransfer: "Cash transfer",
  CashAccount: "Cash account",
  Customer: "Customer",
  Supplier: "Supplier",
  Contact: "Contact",
  Address: "Address",
  BusinessDocument: "Business document",
  DocumentAttachment: "Attachment",
  Delivery: "Delivery",
  User: "User",
  Settings: "Settings",
  Session: "Session",
  TaxCalendarCompletion: "Tax calendar",
  TaxPaidQuarter: "Tax paid",
  SpoiledBookletNumber: "Spoiled booklet no.",
  EmailSuppression: "Email suppression",
};

const PAST: Record<AuditAction, string> = {
  create: "Created",
  update: "Updated",
  archive: "Archived",
  restore: "Restored",
  void: "Voided",
  login: "Signed in",
  login_failed: "Failed sign-in",
  login_2fa_pending: "Two-step sign-in pending",
  settings_change: "Changed settings",
  email_draft: "Drafted email",
  download: "Downloaded",
  delete: "Deleted",
};

/** Number stored on a delete snapshot, so the log can name a row that is gone. */
export function auditDeleteLabel(after: unknown): string | null {
  if (!after || typeof after !== "object" || Array.isArray(after)) return null;
  const n = (after as Record<string, unknown>).number;
  return typeof n === "string" && n.trim() ? n.trim() : null;
}

/** Link to the record, where the app has a page for it. A delete has no link. */
export function auditRecordLink(entityType: string, entityId: string | null, action?: string): string | undefined {
  if (action === "delete") return undefined;
  if (!entityId) return undefined;
  switch (entityType) {
    case "Customer":
      return `/customers/${entityId}`;
    case "Supplier":
      return `/suppliers/${entityId}`;
    case "Contact":
      return `/contacts/${entityId}`;
    case "User":
      return `/settings/users/${entityId}`;
    case "Settings":
      return "/settings?tab=changelog";
    case "Quote":
      return `/quotes/${entityId}`;
    case "SalesOrder":
      return `/sales-orders/${entityId}`;
    case "PurchaseOrder":
      return `/purchase-orders/${entityId}`;
    case "Billing":
      return `/billing/billings/${entityId}`;
    case "Collection":
      return `/billing/collections/${entityId}`;
    default:
      return undefined;
  }
}

type LabelRow = { id: string; label: string };

/** Batch-resolve record ids to numbers/names, one query per entity type. */
export async function resolveAuditLabels(rows: { entityType: string; entityId: string | null }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byType = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.entityId) continue;
    const ids = byType.get(r.entityType) ?? [];
    if (!ids.includes(r.entityId)) ids.push(r.entityId);
    byType.set(r.entityType, ids);
  }
  const put = (type: string, found: LabelRow[]) => {
    for (const f of found) out.set(`${type}:${f.id}`, f.label);
  };
  for (const [type, ids] of byType) {
    switch (type) {
      case "Quote":
      case "SalesOrder":
      case "PurchaseOrder":
      case "Billing":
      case "Collection":
      case "SupplierBill":
      case "ReceivingReport":
      case "SupplierReturn":
      case "SupplierPayment":
      case "Expense":
      case "CashTransfer": {
        const model = {
          Quote: db.quote,
          SalesOrder: db.salesOrder,
          PurchaseOrder: db.purchaseOrder,
          Billing: db.billing,
          Collection: db.collection,
          SupplierBill: db.supplierBill,
          ReceivingReport: db.receivingReport,
          SupplierReturn: db.supplierReturn,
          SupplierPayment: db.supplierPayment,
          Expense: db.expense,
          CashTransfer: db.cashTransfer,
        }[type] as { findMany: (a: { where: { id: { in: string[] } }; select: { id: true; number: true } }) => Promise<{ id: string; number: string }[]> };
        put(type, (await model.findMany({ where: { id: { in: ids } }, select: { id: true, number: true } })).map((r) => ({ id: r.id, label: r.number })));
        break;
      }
      case "Customer":
      case "Supplier":
      case "Contact":
      case "User":
      case "CashAccount": {
        const model = {
          Customer: db.customer,
          Supplier: db.supplier,
          Contact: db.contact,
          User: db.user,
          CashAccount: db.cashAccount,
        }[type] as { findMany: (a: { where: { id: { in: string[] } }; select: { id: true; name: true } }) => Promise<{ id: string; name: string }[]> };
        put(type, (await model.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((r) => ({ id: r.id, label: r.name })));
        break;
      }
      case "BusinessDocument": {
        const found = await db.businessDocument.findMany({ where: { id: { in: ids } }, select: { id: true, type: true, docNumber: true } });
        put(type, found.map((r) => ({ id: r.id, label: r.docNumber ?? r.type })));
        break;
      }
      case "DocumentAttachment": {
        const found = await db.documentAttachment.findMany({ where: { id: { in: ids } }, select: { id: true, fileName: true } });
        put(type, found.map((r) => ({ id: r.id, label: r.fileName })));
        break;
      }
      case "Delivery": {
        const found = await db.delivery.findMany({ where: { id: { in: ids } }, select: { id: true, drNumber: true } });
        put(type, found.map((r) => ({ id: r.id, label: `DR ${r.drNumber}` })));
        break;
      }
      case "TaxCalendarCompletion": {
        const found = await db.taxCalendarCompletion.findMany({ where: { id: { in: ids } }, select: { id: true, obligationKey: true, periodKey: true } });
        put(type, found.map((r) => ({ id: r.id, label: `${r.obligationKey} ${r.periodKey}` })));
        break;
      }
      case "TaxPaidQuarter": {
        const found = await db.taxPaidQuarter.findMany({ where: { id: { in: ids } }, select: { id: true, year: true, quarter: true } });
        put(type, found.map((r) => ({ id: r.id, label: `TY${r.year} Q${r.quarter}` })));
        break;
      }
      case "SpoiledBookletNumber": {
        const found = await db.spoiledBookletNumber.findMany({ where: { id: { in: ids } }, select: { id: true, type: true, number: true } });
        put(type, found.map((r) => ({ id: r.id, label: `${r.type} ${r.number}` })));
        break;
      }
      case "EmailSuppression": {
        const found = await db.emailSuppression.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } });
        put(type, found.map((r) => ({ id: r.id, label: r.email })));
        break;
      }
      case "Address": {
        const found = await db.address.findMany({ where: { id: { in: ids } }, select: { id: true, kind: true, label: true } });
        put(type, found.map((r) => ({ id: r.id, label: r.label ?? r.kind })));
        break;
      }
      default:
        break;
    }
  }
  return out;
}

type AuditRow = {
  entityType: string;
  entityId: string | null;
  action: AuditAction;
  before: unknown;
  after: unknown;
};

function humanField(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Changed field names in plain words (cost fields hidden without permission). */
export function auditChangedFields(row: AuditRow, viewer: PermissionUser | null): string[] {
  const before = asRecord(stripCosts(row.before, viewer));
  const after = asRecord(stripCosts(row.after, viewer));
  if (!before && !after) return [];
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys].filter((k) => JSON.stringify((before ?? {})[k]) !== JSON.stringify((after ?? {})[k])).map(humanField);
}

/** One plain sentence for the row, e.g. "Voided quote QT-2026-0009: reason …". */
export function auditSentence(row: AuditRow, recordLabel: string | null, viewer: PermissionUser | null): string {
  const typeLabel = AUDIT_ENTITY_LABELS[row.entityType] ?? row.entityType;
  const record = recordLabel ?? "record";
  const after = asRecord(row.after);
  if (row.action === "delete") {
    const number = recordLabel ?? auditDeleteLabel(row.after) ?? "record";
    const customer = typeof after?.customerName === "string" && after.customerName.trim() ? after.customerName.trim() : "";
    const reason = typeof after?.reason === "string" && after.reason.trim() ? after.reason.trim() : "";
    const invoice = after?.invoiceNo;
    const si = invoice != null && String(invoice).trim() ? ` (SI no. ${invoice})` : "";
    const who = customer ? ` for ${customer}` : "";
    const why = reason ? `: ${reason}` : "";
    return `Deleted ${typeLabel.toLowerCase()} ${number}${who}${si}${why}`;
  }
  if (row.action === "void") {
    const reason = after?.voidReason ?? after?.reason;
    return `Voided ${typeLabel.toLowerCase()} ${record}${typeof reason === "string" && reason ? `: ${reason}` : ""}`;
  }
  if (row.action === "login") return "Signed in";
  if (row.action === "login_failed") {
    const email = after?.email;
    return typeof email === "string" && email ? `Failed sign-in for ${email}` : "Failed sign-in";
  }
  if (row.entityType === "Settings") {
    const changed = auditChangedFields(row, viewer);
    return `Changed settings${changed.length ? `: ${changed.join(", ")}` : ""}`;
  }
  const verb = PAST[row.action] ?? row.action;
  const changed = row.action === "update" ? auditChangedFields(row, viewer) : [];
  return `${verb} ${typeLabel.toLowerCase()} ${record}${changed.length ? ` (${changed.join(", ")})` : ""}`;
}
