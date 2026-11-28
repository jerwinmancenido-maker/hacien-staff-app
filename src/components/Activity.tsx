// "Activity" section on record pages: audit rows for the record (and its
// contacts / linked chain documents, when the page passes their targets).

import { db } from "@/lib/db";
import { bankViewActivityLabel } from "@/lib/bank-mask";
import { formatDateTime, formatPeso } from "@/lib/format";
import { stripCosts, type PermissionUser } from "@/lib/permissions";
import { DiffView } from "./DiffView";

const ACTION_LABELS: Record<string, string> = {
  create: "created",
  update: "updated",
  archive: "marked inactive",
  restore: "made active",
  void: "voided",
  login: "signed in",
  login_failed: "failed sign-in",
  settings_change: "changed settings",
  email_draft: "drafted an email",
  download: "downloaded",
  delete: "Deleted",
};

const ENTITY_LABELS: Record<string, string> = {
  SupplierPaymentRequest: "a payment request",
  Contact: "a contact",
  Quote: "the quote",
  SalesOrder: "the sales order",
  Billing: "a billing",
  Collection: "a collection",
  Delivery: "a delivery",
  Address: "an address",
  BusinessDocument: "a document",
  PurchaseOrder: "the PO",
  ReceivingReport: "a receiving report",
  SupplierBill: "a supplier bill",
  DocumentAttachment: "an attachment",
  SupplierPayment: "a supplier payment",
  SupplierWithholding2307: "a supplier 2307",
  TaxPaidQuarter: "a tax-paid entry",
  TaxCalendarCompletion: "a tax-calendar note",
};

// Addresses and documents are archived (kept in history), not "marked inactive".
const ARCHIVED_ENTITIES = ["Address", "BusinessDocument"];
function actionLabel(action: string, entityType: string): string {
  if (ARCHIVED_ENTITIES.includes(entityType) && action === "archive") return "archived";
  if (ARCHIVED_ENTITIES.includes(entityType) && action === "restore") return "restored";
  return ACTION_LABELS[action] ?? action;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function textField(row: Record<string, unknown>, key: string): string | null {
  const v = row[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function pesoField(row: Record<string, unknown>, key: string): string | null {
  const v = row[key];
  if (typeof v === "number" && Number.isFinite(v)) return formatPeso(v);
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return formatPeso(v);
  return null;
}

function positiveAmount(row: Record<string, unknown>, key: string): boolean {
  const v = row[key];
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0;
}

/**
 * One plain-language line for the events staff scan for, built ONLY from
 * fields the audit row itself carries (never recomputed, never guessed);
 * rows without the needed fields fall back to the heading + diff rendering.
 * The after-state passed in has already gone through stripCosts for the viewer,
 * so a cost field can never reach a narration line for a non-cost viewer.
 */
function plainLine(entityType: string, action: string, afterRaw: unknown): string | null {
  const after = asRecord(afterRaw);
  if (!after) return null;
  if (action === "create" && entityType === "Billing") {
    const number = textField(after, "number");
    const amount = pesoField(after, "amount");
    if (!number || !amount) return null;
    const invoiceNo = after.invoiceNo;
    const si = typeof invoiceNo === "number" || typeof invoiceNo === "string" ? " · SI " + invoiceNo : "";
    return "Billing " + number + " recorded — " + amount + si;
  }
  if (action === "create" && entityType === "Collection") {
    const number = textField(after, "number");
    const received = pesoField(after, "amountReceived");
    if (!number || !received) return null;
    let line = "Collection " + number + " received — " + received;
    const applied = pesoField(after, "cashApplied");
    if (applied && after.cashApplied !== after.amountReceived) line += " · " + applied + " applied to billings";
    if (positiveAmount(after, "unappliedCredit")) line += " · " + pesoField(after, "unappliedCredit") + " left as credit";
    return line;
  }
  if (action === "create" && entityType === "Delivery") {
    const dr = textField(after, "drNumber");
    if (!dr) return null;
    let line = "Delivery DR " + dr + " recorded";
    const items = after.items;
    if (Array.isArray(items) && items.length) line += " · " + items.length + " item line" + (items.length === 1 ? "" : "s");
    const receivedBy = textField(after, "receivedBy");
    if (receivedBy) line += " · received by " + receivedBy;
    return line;
  }
  if (action === "update" && entityType === "SalesOrder") {
    const billed = textField(after, "billingRecorded");
    if (billed) {
      const amount = pesoField(after, "amount");
      return "Billing " + billed + " recorded against this order" + (amount ? " — " + amount : "");
    }
  }
  if (action === "void") {
    const reason = textField(after, "voidReason");
    if (reason) return "Reason: " + reason;
  }
  return null;
}

/**
 * viewer: pass on pages whose audit rows can hold costs (quotes, sales
 * orders); cost fields are then removed for users without "Can see costs".
 */
export async function Activity({
  targets,
  title = "Activity",
  viewer,
}: {
  targets: { entityType: string; ids: string[] }[];
  title?: string;
  viewer?: PermissionUser;
}) {
  const validTargets = targets.filter((t) => t.ids.length);
  const rows = validTargets.length
    ? await db.auditLog.findMany({
        where: { OR: validTargets.map((t) => ({ entityType: t.entityType, entityId: { in: t.ids } })) },
        include: { user: { select: { name: true } } },
        orderBy: { at: "desc" },
        take: 30,
      })
    : [];
  return (
    <div className="card activity-card">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <div className="muted small">No activity yet.</div>
      ) : (
        <div className="activity-timeline">
          {rows.map((r, i) => {
            const afterForViewer = viewer ? stripCosts(r.after, viewer) : r.after;
            const beforeForViewer = viewer ? stripCosts(r.before, viewer) : r.before;
            const narration = plainLine(r.entityType, r.action, afterForViewer);
            return (
              <div key={r.id} className="activity-timeline-item">
                <div className="timeline-node">
                  <span className="timeline-dot" aria-hidden />
                  {i < rows.length - 1 && <span className="timeline-line" aria-hidden />}
                </div>
                <div className="timeline-content">
                  <div className="timeline-heading">
                    <b>{r.user?.name ?? "System"}</b>{" "}
                    {bankViewActivityLabel(r.after) ?? (
                      <>
                        {actionLabel(r.action, r.entityType)}{" "}
                        {targets.length > 1 || !["Quote", "SalesOrder"].includes(r.entityType) ? (ENTITY_LABELS[r.entityType] ?? "") : ""}
                      </>
                    )}
                  </div>
                  <div className="timeline-when">{formatDateTime(r.at)}</div>
                  {narration && <div className="muted small">{narration}</div>}
                  {(r.action === "update" || r.action === "void") && <DiffView before={beforeForViewer} after={afterForViewer} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
