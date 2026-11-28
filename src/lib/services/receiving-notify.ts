// Goods-received team notification (ERP adoption item 5, Review Board
// run 103). When a receiving report posts, the team hears about it once:
// one email per recipient plus the bell's computed "Goods received"
// section (src/lib/notifications.ts) as the in-app twin.
//
// Recipients: the PO's creator + every ACTIVE Admin/Approver user — the
// people who can act on receiving next (bill it, pay it, chase the rest).
// Never the supplier: this is an internal note and carries no prices.
//
// Failure posture (the store-orders intake pattern): this runs AFTER the
// receiving transaction commits and NEVER throws — a mail failure is
// logged and audited, the receiving stands. Settings toggle:
// features.receivingEmailEnabled (default ON).

import { db } from "../db";
import { writeAudit } from "../audit";
import { appUrl, getMailer, type Mailer } from "../mailer";
import { getSettingsSnapshot } from "../settings";
import { emailIdentity } from "../settings/identity";
import { receivingNotificationEmail } from "../email-templates";
import { sanitizeHeaderValue } from "./statement-reminder";
import { formatDate } from "../format";

export type ReceivingNotifyResult = {
  status: "sent" | "partial" | "failed" | "skipped" | "disabled";
  recipients: string[];
};

export async function notifyGoodsReceived(
  receivingReportId: string,
  deps: { mailer?: Mailer } = {},
): Promise<ReceivingNotifyResult> {
  try {
    const snap = await getSettingsSnapshot();
    if (!snap.settings.features.receivingEmailEnabled) return { status: "disabled", recipients: [] };

    const rr = await db.receivingReport.findUnique({
      where: { id: receivingReportId },
      include: {
        receivedBy: { select: { name: true } },
        createdBy: { select: { name: true } },
        items: { select: { purchaseOrderItemId: true, qtyReceived: true } },
        purchaseOrder: {
          select: {
            id: true,
            number: true,
            status: true,
            createdById: true,
            supplier: { select: { name: true } },
            items: {
              where: { removedAt: null },
              orderBy: { sortOrder: "asc" },
              select: { id: true, description: true, unit: true, qty: true, receivedQty: true },
            },
          },
        },
      },
    });
    // A voided (or missing) report announces nothing.
    if (!rr || rr.status !== "POSTED") return { status: "skipped", recipients: [] };
    const po = rr.purchaseOrder;

    const users = await db.user.findMany({
      where: { active: true, OR: [{ isAdmin: true }, { isApprover: true }, { id: po.createdById }] },
      select: { email: true },
      orderBy: { email: "asc" },
    });
    const recipients = [...new Map(users.map((u) => [u.email.toLowerCase(), u.email])).values()];
    if (recipients.length === 0) {
      console.error(`[receiving] goods-received email for ${rr.number} has no recipients.`);
      return { status: "skipped", recipients: [] };
    }

    const poLineById = new Map(po.items.map((l) => [l.id, l]));
    const receivedLines = rr.items
      .filter((i) => Number(i.qtyReceived) > 0)
      .map((i) => {
        const line = poLineById.get(i.purchaseOrderItemId);
        return {
          title: line?.description ?? "(line removed from the PO)",
          unit: line?.unit ?? "",
          qtyNow: String(i.qtyReceived),
          qtyReceivedTotal: String(line?.receivedQty ?? i.qtyReceived),
          qtyOrdered: String(line?.qty ?? i.qtyReceived),
        };
      });
    const outstanding = po.items
      .filter((l) => Number(l.qty) > Number(l.receivedQty))
      .map((l) => ({
        title: l.description,
        unit: l.unit,
        qtyRemaining: (Number(l.qty) - Number(l.receivedQty)).toFixed(2),
      }));

    const draft = receivingNotificationEmail(
      {
        poNumber: po.number,
        rrNumber: rr.number,
        supplierName: po.supplier.name,
        recordedByName: rr.createdBy.name,
        receivedByName: rr.receivedBy.name,
        receivedDateLabel: formatDate(rr.receivedDate),
        fullyReceived: po.status === "RECEIVED",
        lines: receivedLines,
        outstanding,
        poUrl: appUrl(`/purchase-orders/${po.id}`),
      },
      emailIdentity(snap.settings),
    );
    const subject = sanitizeHeaderValue(draft.subject);

    const mailer = deps.mailer ?? getMailer();
    let sent = 0;
    let failed = 0;
    for (const to of recipients) {
      try {
        await mailer.send({ to, subject, text: draft.text, html: draft.html });
        sent += 1;
      } catch {
        failed += 1;
      }
    }
    const status: ReceivingNotifyResult["status"] = failed === 0 ? "sent" : sent === 0 ? "failed" : "partial";

    try {
      await writeAudit(db, {
        userId: rr.createdById,
        entityType: "ReceivingReport",
        entityId: rr.id,
        action: "send_email",
        after: { recipients, receivingEmail: status, subject },
        diff: false,
      });
    } catch {
      // Auditing the send must never throw either.
    }
    if (failed > 0) {
      console.error(`[receiving] goods-received email for ${rr.number}: ${sent} sent, ${failed} failed.`);
    }
    return { status, recipients };
  } catch (e) {
    const name = e instanceof Error ? e.name : "Error";
    console.error(`[receiving] goods-received notification failed name=${name}`);
    return { status: "failed", recipients: [] };
  }
}
