import { db } from "@/lib/db";
import { getSettingsSnapshot, getSettingsVersion } from "@/lib/settings";
import { money, ymd } from "@/lib/documents/common";
import { formatDate } from "@/lib/format";
import { mergeCompanyLetterhead, paymentInstructionsFromSettings, printCompanyBlock } from "@/lib/print/company";
import { qrSvg } from "@/lib/print/qr";
import { POLICIES_URL, POLICY_VERSION_LINE } from "@/lib/print/policies";

/**
 * S-64: packing list & delivery details attachment sheet.
 *
 * This is an ATTACHMENT ONLY — never a Delivery Receipt or Sales Invoice.
 * It is computer-generated and always issued with the manual BIR DR/SI.
 * Contents: items + qty + serial numbers, warranty period/note, official
 * HACIEN bank details, linked manual DR and SI numbers, QR + policies URL.
 * The version line uses the live policies constant (the board row's
 * "Privacy v2.2" text is stale — the live line wins).
 */

export type AttachmentSheetItem = {
  description: string;
  qty: string;
  serials: string[];
  note: string | null;
};

export type AttachmentSheet = {
  deliveryId: string;
  salesOrderId: string;
  salesOrderNumber: string;
  drNumber: string;
  siNumbers: string;
  deliveryDate: string;
  receivedBy: string | null;
  customerName: string;
  customerAddress: string | null;
  items: AttachmentSheetItem[];
  warrantyNotes: string | null;
  banks: { label: string; accountName: string; accountPrinted: string }[];
  company: ReturnType<typeof printCompanyBlock>;
  qrSvg: string;
  policiesUrl: string;
  versionLine: string;
  missing: string[];
};

/** Serial numbers are stored comma-separated; display them as a list. */
export function splitSerials(serialNumbers: string | null | undefined): string[] {
  if (!serialNumbers) return [];
  return serialNumbers
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** SI numbers for the title line: linked manual SI numbers, or a blank when none yet. */
export function formatSiNumbers(invoiceNos: string[]): string {
  const nos = invoiceNos.map((n) => n.trim()).filter(Boolean);
  return nos.length ? nos.join(", ") : "___";
}

export async function getAttachmentSheetModel(deliveryId: string): Promise<AttachmentSheet | null> {
  const delivery = await db.delivery.findUnique({
    where: { id: deliveryId },
    include: {
      items: {
        orderBy: { id: "asc" },
        include: { salesOrderItem: { select: { description: true, unit: true } } },
      },
      salesOrder: {
        select: {
          id: true,
          number: true,
          settingsVersionId: true,
          customer: { select: { name: true, address: true } },
          quote: { select: { deliveryNotes: true, warrantyNotes: true } },
        },
      },
    },
  });
  if (!delivery || delivery.voidedAt) return null;
  const so = delivery.salesOrder;
  const latest = await getSettingsSnapshot();
  const pinned = so.settingsVersionId ? await getSettingsVersion(so.settingsVersionId) : null;
  const settings = (pinned ?? latest).settings;
  const company = mergeCompanyLetterhead(pinned?.settings.company, latest.settings.company);
  const billings = await db.billing.findMany({
    where: { salesOrderId: so.id, status: { not: "VOID" } },
    select: { invoiceNo: true },
    orderBy: { invoiceDate: "asc" },
  });
  const warrantyNotes = so.quote.warrantyNotes?.trim() || settings.print.warrantyNotes?.trim() || null;
  return {
    deliveryId: delivery.id,
    salesOrderId: so.id,
    salesOrderNumber: so.number,
    drNumber: delivery.drNumber,
    siNumbers: formatSiNumbers(billings.map((b) => String(b.invoiceNo))),
    deliveryDate: formatDate(new Date(ymd(delivery.deliveryDate)!)),
    receivedBy: delivery.receivedBy,
    customerName: so.customer.name,
    customerAddress: so.customer.address,
    items: delivery.items.map((i) => ({
      description: i.salesOrderItem.description,
      qty: `${money(i.qty)} ${i.salesOrderItem.unit}`,
      serials: splitSerials(i.serialNumbers),
      note: i.note,
    })),
    warrantyNotes,
    banks: paymentInstructionsFromSettings(settings.print).filter((p) => p.kind === "bank"),
    company: printCompanyBlock(company),
    qrSvg: await qrSvg(),
    policiesUrl: POLICIES_URL,
    versionLine: POLICY_VERSION_LINE,
    missing: [],
  };
}
