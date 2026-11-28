import { db } from "@/lib/db";
import { addDays, formatDate, manilaToday } from "@/lib/format";
import { can, canSeeCosts, type PermissionUser } from "@/lib/permissions";
import { accessReviewDue } from "@/lib/access-review";
import { arAgingSummary } from "@/lib/billing/views";
import { billingBalance } from "@/lib/billing/status";
import { money } from "@/lib/documents/common";
import { countWarrantiesEndingSoon, listWarrantiesEndingSoon } from "@/lib/purchasing/views";
import { storeOrderBellData } from "@/lib/store-orders/views";
import type { NotificationSection } from "./notification-types";
export type { NotificationItem, NotificationSection } from "./notification-types";

/**
 * S-57: notifications bell. Four sections, each with a count and up to five
 * items linking to the record or list that needs attention:
 * - Approvals: quotes waiting for approval (approvers only).
 * - Overdue: AR overdue total from the aging summary (grace + government
 *   rules applied there, so the bell never disagrees with /billing/aging).
 * - Payment reminders: unpaid billings due in the next 7 days.
 * - Late delivery: sent/partially-received POs past their expected date
 * - Goods received: POSTED receiving reports from the last 7 days
 *   (adoption item 5, the bell twin of the receiving email).
 *   (cost viewers only — the PO pages are cost-gated).
 * - Access review (S-58 sync addition): Admin only, shown when the last
 *   access review is over 90 Manila days old or never happened.
 * - SL-05 Warranty ending soon: POSTED receiving lines whose supplier
 *   warranty ends in the next 30 Manila days (everyone with view).
 */

export async function getNotifications(user: PermissionUser): Promise<NotificationSection[]> {
  const today = manilaToday();
  const sections: NotificationSection[] = [];

  if (can(user, "approve")) {
    const pending = await db.quote.findMany({
      where: { approvalStatus: "PENDING", status: { not: "VOID" } },
      select: { id: true, number: true, customer: { select: { name: true } } },
      orderBy: { date: "asc" },
      take: 5,
    });
    const count = await db.quote.count({ where: { approvalStatus: "PENDING", status: { not: "VOID" } } });
    if (count > 0) {
      sections.push({
        key: "approvals",
        label: "Waiting for approval",
        count,
        href: "/quotes",
        items: pending.map((q) => ({ label: `${q.number} · ${q.customer.name}`, href: `/quotes/${q.id}` })),
      });
    }
  }

  if (can(user, "edit_data")) {
    const storeOrders = await storeOrderBellData();
    if (storeOrders.count > 0) {
      sections.push({
        key: "store-orders",
        label: "Store orders to convert",
        count: storeOrders.count,
        href: "/store-orders",
        items: storeOrders.items,
      });
    }
  }

  const aging = await arAgingSummary();
  if (aging.overdueCount > 0) {
    sections.push({
      key: "overdue",
      label: "Overdue",
      count: aging.overdueCount,
      href: "/billing/aging",
      items: [{ label: `${aging.overdueCount} billing${aging.overdueCount === 1 ? "" : "s"} overdue`, href: "/billing/aging" }],
    });
  }

  const dueSoon = await db.billing.findMany({
    where: {
      status: { not: "VOID" },
      dueDate: { gte: today, lte: addDays(today, 7) },
    },
    select: {
      id: true,
      number: true,
      invoiceNo: true,
      amount: true,
      dueDate: true,
      customer: { select: { name: true } },
      allocations: { where: { collection: { status: "POSTED" } }, select: { cashApplied: true, withholdingApplied: true } },
    },
    orderBy: { dueDate: "asc" },
  });
  const dueSoonOpen = dueSoon.filter((b) => {
    const cashApplied = b.allocations.reduce((sum, a) => sum + Number(a.cashApplied), 0);
    const withholdingApplied = b.allocations.reduce((sum, a) => sum + Number(a.withholdingApplied), 0);
    return (
      Number(
        billingBalance(money(b.amount), {
          cashApplied: String(cashApplied),
          withholdingApplied: String(withholdingApplied),
        }),
      ) > 0
    );
  });
  if (dueSoonOpen.length > 0) {
    sections.push({
      key: "due-soon",
      label: "Payment reminders",
      count: dueSoonOpen.length,
      href: "/billing/aging",
      items: dueSoonOpen.slice(0, 5).map((b) => ({
        label: `${b.number} · ${b.customer.name} · due ${formatDate(b.dueDate)}`,
        href: `/billing/billings/${b.id}`,
      })),
    });
  }

  if (canSeeCosts(user)) {
    const late = await db.purchaseOrder.findMany({
      where: {
        status: { in: ["SENT", "PARTIALLY_RECEIVED"] },
        expectedDate: { not: null, lt: today },
      },
      select: { id: true, number: true, supplier: { select: { name: true } } },
      orderBy: { expectedDate: "asc" },
      take: 5,
    });
    const lateCount = await db.purchaseOrder.count({
      where: {
        status: { in: ["SENT", "PARTIALLY_RECEIVED"] },
        expectedDate: { not: null, lt: today },
      },
    });
    if (lateCount > 0) {
      sections.push({
        key: "late",
        label: "Late delivery",
        count: lateCount,
        href: "/purchase-orders",
        items: late.map((po) => ({ label: `${po.number} · ${po.supplier.name}`, href: `/purchase-orders/${po.id}` })),
      });
    }
  }

  // Adoption item 5 (bell twin of the receiving email): POSTED receiving
  // reports from the last 7 days. Computed like every other section - a
  // voided report drops out on its own. Quantities only, no prices, so -
  // like the receiving pages - it is visible to everyone who can view.
  const receivedSince = addDays(today, -7);
  const recentReceipts = await db.receivingReport.findMany({
    where: { status: "POSTED", createdAt: { gte: receivedSince } },
    select: {
      id: true,
      number: true,
      purchaseOrderId: true,
      purchaseOrder: { select: { number: true, supplier: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const recentReceiptCount = await db.receivingReport.count({
    where: { status: "POSTED", createdAt: { gte: receivedSince } },
  });
  if (recentReceiptCount > 0) {
    sections.push({
      key: "goods-received",
      label: "Goods received",
      count: recentReceiptCount,
      href: "/receiving",
      items: recentReceipts.map((r) => ({
        label: `${r.number} · ${r.purchaseOrder.number} · ${r.purchaseOrder.supplier.name}`,
        href: `/receiving/${r.purchaseOrderId}`,
      })),
    });
  }

  if (can(user, "manage_settings")) {
    const last = await db.accessReview.findFirst({ orderBy: { reviewedAt: "desc" }, select: { reviewedAt: true } });
    if (accessReviewDue(last?.reviewedAt ?? null)) {
      sections.push({
        key: "access-review",
        label: "Access review",
        count: 1,
        href: "/settings?tab=users",
        items: [{ label: "Review who can sign in and with which roles", href: "/settings?tab=users" }],
      });
    }
  }

  // SL-05: visible to everyone with view (layout already gates the app).
  const warrantySoonCount = await countWarrantiesEndingSoon(today);
  if (warrantySoonCount > 0) {
    const warrantySoon = await listWarrantiesEndingSoon({ take: 5, now: today });
    sections.push({
      key: "warranty-soon",
      label: "Warranty ending soon",
      count: warrantySoonCount,
      href: "/receiving?warranty=soon",
      items: warrantySoon.map((r) => ({
        label: `${r.purchaseOrderNumber} · ${r.supplierName} · ends ${formatDate(new Date(`${r.warrantyEndDate}T00:00:00.000Z`))}`,
        href: `/receiving/${r.purchaseOrderId}`,
      })),
    });
  }

  return sections;
}
