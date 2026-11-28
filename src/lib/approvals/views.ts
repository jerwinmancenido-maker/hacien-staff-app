// Approval inbox read model (ERP adoption item 1 — Review Board run 103).
//
// Census of approval-bearing documents (2026-11-28, at staging 957611f5):
// exactly two types carry an approval decision for our own staff —
//   Quotes       — QuoteApprovalStatus PENDING on an open quote
//                  (services/quotes.ts approveQuote / rejectQuote,
//                  "approve" permission).
//   Supplier POs — status DRAFT above the approval limit in the PO's
//                  pinned Settings version (services/purchase-orders.ts
//                  approvePurchaseOrder, "approve" permission + cost
//                  access). No reject flow exists for POs, so the inbox
//                  offers none.
// Everything else that looks similar is NOT an approval: Withholding2307
// PENDING is certificate-receipt tracking (manage_billing), a warranty
// claim's APPROVED / REJECTED records the supplier's answer rather than
// ours, and expenses carry no approval fields at all.
//
// This module only READS. Acting on a row goes through the same services
// and permission gates as the document pages (approvals/actions.ts).

import { db } from "@/lib/db";
import { money } from "@/lib/documents/common";
import { isoDate } from "@/lib/format";
import { canSeeCosts, type PermissionUser } from "@/lib/permissions";
import { approvalReasons, supplierCostStateFromSupplierTotals } from "@/lib/quotes/calc";
import { getSettingsSnapshot, getSettingsVersionsMap } from "@/lib/settings";
import { poApproveBlockedReason, poWaitsForApproval, visibleApprovalReasons } from "./rules";

export type ApprovalQuoteRow = {
  kind: "quote";
  id: string;
  number: string;
  customerName: string;
  businessName: string | null;
  /** Contract price, money string. */
  total: string;
  /** Quote date, yyyy-mm-dd. */
  date: string;
  createdByName: string;
  /** Approval reasons this viewer may see (cost reasons filtered by the rules helper). */
  reasons: string[];
  /** True when at least one reason exists but is hidden from this viewer. */
  reasonsHidden: boolean;
};

export type ApprovalPoRow = {
  kind: "po";
  id: string;
  number: string;
  supplierName: string;
  businessName: string | null;
  /** PO subtotal, money string. */
  total: string;
  /** PO date, yyyy-mm-dd. */
  date: string;
  createdByName: string;
  /** Why this viewer cannot approve this PO (self-approval rule), or null when they can. */
  blockedReason: string | null;
};

export type ApprovalInbox = {
  quotes: ApprovalQuoteRow[];
  /** Empty unless the viewer can see costs — PO pages and actions are cost-gated. */
  purchaseOrders: ApprovalPoRow[];
  total: number;
};

export async function listApprovalInbox(viewer: PermissionUser & { id: string }): Promise<ApprovalInbox> {
  const withCosts = canSeeCosts(viewer);

  // Open quotes only — WON / LOST / VOID stay out, the same definition as
  // the Home "Waiting for approval" list (quotes/views.ts needsApproval).
  const quotes = await db.quote.findMany({
    where: { approvalStatus: "PENDING", status: { in: ["DRAFT", "SENT"] } },
    select: {
      id: true,
      number: true,
      date: true,
      contractPrice: true,
      netMarginPct: true,
      settingsVersionId: true,
      customer: { select: { name: true } },
      business: { select: { name: true } },
      createdBy: { select: { name: true } },
      items: { where: { removedAt: null }, select: { supplierTotal: true } },
    },
    orderBy: [{ date: "asc" }, { number: "asc" }],
  });

  const pos = withCosts
    ? await db.purchaseOrder.findMany({
        where: { status: "DRAFT" },
        select: {
          id: true,
          number: true,
          date: true,
          subtotal: true,
          settingsVersionId: true,
          createdById: true,
          supplier: { select: { name: true } },
          business: { select: { name: true } },
          createdBy: { select: { name: true } },
        },
        orderBy: [{ date: "asc" }, { number: "asc" }],
      })
    : [];

  const snaps = await getSettingsVersionsMap([
    ...quotes.map((q) => q.settingsVersionId),
    ...pos.map((p) => p.settingsVersionId),
  ]);
  // Quotes mirror storedApprovalReasons (services/quotes.ts): the pinned
  // version, falling back to the current snapshot when the pin is gone.
  const current = quotes.some((q) => !snaps.has(q.settingsVersionId)) ? await getSettingsSnapshot() : null;

  const quoteRows: ApprovalQuoteRow[] = quotes.map((q) => {
    const snap = snaps.get(q.settingsVersionId) ?? current;
    const all = snap
      ? approvalReasons(
          {
            contractPrice: money(q.contractPrice),
            netMarginPct: money(q.netMarginPct),
            supplierCostState: supplierCostStateFromSupplierTotals(q.items.map((i) => money(i.supplierTotal))),
          },
          snap.settings.approval,
        )
      : [];
    const vis = visibleApprovalReasons(all, withCosts);
    return {
      kind: "quote",
      id: q.id,
      number: q.number,
      customerName: q.customer.name,
      businessName: q.business?.name ?? null,
      total: money(q.contractPrice),
      date: isoDate(q.date),
      createdByName: q.createdBy.name,
      reasons: vis.reasons,
      reasonsHidden: vis.hidden,
    };
  });

  const poRows: ApprovalPoRow[] = pos
    .filter((p) => {
      // PO pins do NOT fall back to current settings (purchasing/views.ts
      // fails closed on a missing pin), so read the map only.
      const snap = snaps.get(p.settingsVersionId);
      return poWaitsForApproval(money(p.subtotal), snap ? snap.settings.approval.poTotalAbove : null);
    })
    .map((p) => ({
      kind: "po",
      id: p.id,
      number: p.number,
      supplierName: p.supplier.name,
      businessName: p.business?.name ?? null,
      total: money(p.subtotal),
      date: isoDate(p.date),
      createdByName: p.createdBy.name,
      blockedReason: poApproveBlockedReason(viewer, p.createdById),
    }));

  return { quotes: quoteRows, purchaseOrders: poRows, total: quoteRows.length + poRows.length };
}
