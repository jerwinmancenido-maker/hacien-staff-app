import { db } from "@/lib/db";
import { getSettingsSnapshot, getSettingsVersion } from "@/lib/settings";
import { money, ymd } from "@/lib/documents/common";
import { formatDate } from "@/lib/format";
import { formatBookletNumber } from "@/lib/billing/booklet";
import {
  mergeCompanyLetterhead,
  paymentInstructionsFromSettings,
  printCompanyBlock,
  printFooterIdentity,
} from "@/lib/print/company";
import { qrSvg } from "@/lib/print/qr";

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
  /** Catalog identity ("SKU x · Brand · Model") when the line links to
   * a catalog Item that carries any of the three; null for free-text
   * lines — they print exactly as before (D18). */
  meta: string | null;
  qty: string;
  serials: string[];
  note: string | null;
  /** Lot (bundle) lines print with the bold navy lot-title styling. */
  isLot: boolean;
  /** Lot components (description + qty/unit only — never supplier or
   * cost), so the receiver can check the bundle's contents on paper. */
  parts: { description: string; qty: string; meta: string | null }[];
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
  /** The order's contact person — the driver needs a name and phone
   * number on the paper at the gate. */
  contactName: string | null;
  contactPhone: string | null;
  items: AttachmentSheetItem[];
  warrantyNotes: string | null;
  banks: { label: string; accountName: string; accountPrinted: string }[];
  company: ReturnType<typeof printCompanyBlock>;
  qrSvg: string;
  policiesUrl: string;
  versionLine: string;
  /** Print wording from the pinned Settings (Company Profile slice 2). */
  packingDisclaimer: string;
  inputTaxDisclaimer: string;
  /** "<short name> bank details" — the payment block's label, from Settings identity. */
  bankLabel: string;
  /** @page footer identity from the pinned Settings (slice 2, census F1). */
  footerLine: string;
  footerMark: string;
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

/** Packing-list quantities print whole when they are whole ("2 pc", not
 * "2.00 pc") — the same ".00" strip the professional documents apply. */
const qtyText = (qty: { toFixed(n: number): string } | number | string, unit: string) =>
  `${money(qty).replace(/\.00$/, "")} ${unit}`;

/** Catalog identity for a print line, in the quote editor caption's
 * format ("SKU x · Brand · Model"); null when the line links to no
 * catalog item, or the item carries none of the three fields. */
export function itemMetaText(
  item: { brand: string | null; model: string | null; sku: string | null } | null | undefined,
): string | null {
  if (!item) return null;
  const text = [item.sku ? `SKU ${item.sku}` : null, item.brand, item.model].filter(Boolean).join(" · ");
  return text || null;
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
        include: {
          salesOrderItem: {
            select: {
              description: true,
              unit: true,
              isLot: true,
              quoteItemId: true,
              // Same select shape as the print lot-components include in
              // views.ts: description + qty + unit only — supplier and
              // cost never reach this sheet. D18 adds the component's
              // catalog identity (brand/model/SKU) so the receiver can
              // match the physical item to the catalog.
              components: {
                where: { removedAt: null },
                orderBy: { sortOrder: "asc" },
                select: {
                  description: true,
                  qty: true,
                  unit: true,
                  item: { select: { brand: true, model: true, sku: true } },
                },
              },
            },
          },
        },
      },
      salesOrder: {
        select: {
          id: true,
          number: true,
          settingsVersionId: true,
          deliveryAddress: true,
          customer: { select: { name: true, address: true } },
          contact: { select: { name: true, phone: true } },
          quote: { select: { deliveryNotes: true, warrantyNotes: true } },
        },
      },
    },
  });
  if (!delivery || delivery.voidedAt) return null;
  const so = delivery.salesOrder;
  // D18: an SO line carries no catalog link of its own — it reaches its
  // Item through the quote line it was copied from at conversion
  // (quoteItemId → QuoteItem.item). Lot components link directly (the
  // select above). Lines with no link, or items with no brand/model/SKU,
  // print no meta line.
  const quoteItemIds = [
    ...new Set(delivery.items.map((i) => i.salesOrderItem.quoteItemId).filter((v): v is string => Boolean(v))),
  ];
  const quoteItems = quoteItemIds.length
    ? await db.quoteItem.findMany({
        where: { id: { in: quoteItemIds } },
        select: { id: true, item: { select: { brand: true, model: true, sku: true } } },
      })
    : [];
  const itemByQuoteItemId = new Map(quoteItems.map((qi) => [qi.id, qi.item]));
  const latest = await getSettingsSnapshot();
  const pinned = so.settingsVersionId ? await getSettingsVersion(so.settingsVersionId) : null;
  const settings = (pinned ?? latest).settings;
  const company = mergeCompanyLetterhead(pinned?.settings.company, latest.settings.company);
  const billings = await db.billing.findMany({
    where: { salesOrderId: so.id, status: { not: "VOID" } },
    select: { invoiceNo: true },
    orderBy: { invoiceDate: "asc" },
  });
  const warrantyNotes = so.quote?.warrantyNotes?.trim() || settings.print.warrantyNotes?.trim() || null;
  const footerIdentity = printFooterIdentity(company, settings.identity);
  return {
    deliveryId: delivery.id,
    salesOrderId: so.id,
    salesOrderNumber: so.number,
    drNumber: delivery.drNumber,
    siNumbers: formatSiNumbers(billings.map((b) => formatBookletNumber(b.invoiceNo))),
    deliveryDate: formatDate(new Date(ymd(delivery.deliveryDate)!)),
    receivedBy: delivery.receivedBy,
    customerName: so.customer.name,
    // F22: the address the goods go to is the SO's chosen delivery
    // address (stored at conversion) — the customer's legacy free-text
    // address is only a fallback. Using the customer field alone left
    // the packing list's Delivery address blank ("—") whenever that
    // field was empty, even with a full address on the order.
    customerAddress: so.deliveryAddress ?? so.customer.address,
    contactName: so.contact?.name ?? null,
    contactPhone: so.contact?.phone ?? null,
    items: delivery.items.map((i) => ({
      description: i.salesOrderItem.description,
      meta: itemMetaText(i.salesOrderItem.quoteItemId ? itemByQuoteItemId.get(i.salesOrderItem.quoteItemId) : null),
      qty: qtyText(i.qty, i.salesOrderItem.unit),
      serials: splitSerials(i.serialNumbers),
      note: i.note,
      isLot: i.salesOrderItem.isLot,
      parts: i.salesOrderItem.components.map((c) => ({
        description: c.description,
        qty: qtyText(c.qty, c.unit),
        meta: itemMetaText(c.item),
      })),
    })),
    warrantyNotes,
    banks: paymentInstructionsFromSettings(settings.print).filter((p) => p.kind === "bank"),
    company: printCompanyBlock(company, settings.wording),
    qrSvg: await qrSvg(settings.identity.policiesUrl),
    policiesUrl: settings.identity.policiesUrl,
    versionLine: settings.identity.policyVersionLine,
    packingDisclaimer: settings.wording.packingListDisclaimer,
    inputTaxDisclaimer: settings.wording.inputTaxDisclaimer,
    bankLabel: `${settings.identity.appShortName} bank details`,
    footerLine: footerIdentity.line,
    footerMark: footerIdentity.mark,
    missing: [],
  };
}
