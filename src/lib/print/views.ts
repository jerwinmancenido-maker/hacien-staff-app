// Build ProfessionalPrintModel for every printable document.
// Customer docs omit supplier/cost/margin; supplier docs omit customer sell prices.

import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { money, ymd } from "@/lib/documents/common";
import { getSettingsSnapshot, getSettingsVersion } from "@/lib/settings";
import { customerBlockAddress, suggestedDeliveryAddress } from "@/lib/services/addresses";
import { formatAddress } from "@/lib/addresses/format";
import { AGING_BUCKET_LABELS, AGING_BUCKETS } from "@/lib/billing/aging";
import { getStatement } from "@/lib/billing/views";
import { COLLECTION_METHOD_LABELS } from "@/lib/validation/billing";
import { canSeeCosts, ForbiddenError, type PermissionUser } from "@/lib/permissions";
import { ratePctLabel, type WithholdingSnapshot } from "@/lib/quotes/calc";
import { snapshotList } from "@/lib/services/withholding";
import { amountInWords } from "./amount-in-words";
import { printablePersonName } from "./signatory";

function assertCosts(viewer: PermissionUser) {
  if (!canSeeCosts(viewer)) throw new ForbiddenError();
}
import {
  companyContactLine,
  missingCompanyPrintFields,
  paperSizeFromSettings,
  paymentInstructionsFromSettings,
  printCompanyBlock,
  watermarkForStatus,
} from "./company";
import { qrSvg, TERMS_URL } from "./qr";
import { EWT_2307_NOTE, HIDE_STATUS_ON_PRINT, taxFooterLines, THANK_YOU, type PrintDocKind } from "./tax-wording";
import type { ProfessionalPrintModel, PrintLineItem, PrintMoneyLine, PrintSignatory } from "./types";

/** Split a stored description into title + optional detail line (first newline). */
function splitDescription(raw: string): { description: string; detail: string | null } {
  const parts = raw.split(/\n/);
  const description = (parts[0] ?? "").trim() || raw;
  const detail = parts.slice(1).join("\n").trim() || null;
  return { description, detail };
}

function customerSignatories(preparedName: string | null): PrintSignatory[] {
  return [
    { role: "Prepared by", name: printablePersonName(preparedName), position: null },
    { role: "Conforme", name: null },
  ];
}

/** Totals for customer quotes/SOs: Subtotal, Total, optional est. WHT + net. */
export function customerMoneyTotals(opts: {
  contractPrice: string;
  withholdingTotal: string;
  netReceived: string;
  withholding: WithholdingSnapshot[];
}): PrintMoneyLine[] {
  const total = opts.contractPrice;
  const lines: PrintMoneyLine[] = [
    { label: "Subtotal", amount: total },
    { label: "Total", amount: total, emphasize: true },
  ];
  if (Number(opts.withholdingTotal) > 0) {
    const pct = opts.withholding.map((w) => ratePctLabel(w.rate)).join(" + ");
    lines.push({ label: `Less: withholding tax (est.) ${pct}`, amount: opts.withholdingTotal });
    lines.push({ label: "Net amount due", amount: opts.netReceived, emphasize: true });
  }
  return lines;
}

const day = (ymdStr: string | null | undefined) =>
  ymdStr ? formatDate(new Date(`${ymdStr}T00:00:00.000Z`)) : "—";

async function letterhead(settingsVersionId?: string | null) {
  const snap = settingsVersionId
    ? ((await getSettingsVersion(settingsVersionId)) ?? (await getSettingsSnapshot()))
    : await getSettingsSnapshot();
  const { company, print } = snap.settings;
  return {
    company: printCompanyBlock(company),
    print,
    contactLine: companyContactLine(company),
    paperSize: paperSizeFromSettings(print),
    missing: missingCompanyPrintFields(company),
    rawCompany: company,
  };
}

function baseFooter(
  kind: PrintDocKind,
  letter: Awaited<ReturnType<typeof letterhead>>,
  opts: { thankYou?: boolean; includePayment?: boolean; qr?: boolean } = {},
): Pick<
  ProfessionalPrintModel,
  "taxLines" | "thankYou" | "paymentInstructions" | "contactLine" | "qrSvg" | "termsUrl" | "paperSize"
> {
  return {
    paperSize: letter.paperSize,
    taxLines: taxFooterLines(kind, { showInputTaxDisclaimer: letter.print.showInputTaxDisclaimer }),
    thankYou: opts.thankYou ?? false,
    paymentInstructions: opts.includePayment ? paymentInstructionsFromSettings(letter.print) : undefined,
    contactLine: letter.contactLine,
    qrSvg: null,
    termsUrl: opts.qr ? TERMS_URL : null,
  };
}

async function withQr<T extends ProfessionalPrintModel>(doc: T): Promise<T> {
  if (!doc.termsUrl) return doc;
  return { ...doc, qrSvg: await qrSvg() };
}

const itemRow = (
  i: { description: string; detail?: string | null; qty: string; unit: string; unitPrice: string; amount: string },
): PrintLineItem => i;

/**
 * Subtotal + optional mid-lines + Total.
 * The Total amount always equals `subtotal` — amounts in `extra` are listed but do not change Total.
 */
export function moneyTotals(
  subtotal: string,
  extra: PrintMoneyLine[] = [],
  totalLabel = "Total",
): PrintMoneyLine[] {
  return [{ label: "Subtotal", amount: subtotal }, ...extra, { label: totalLabel, amount: subtotal, emphasize: true }];
}

// ---------------------------------------------------------------------------
// Quote / Sales order
// ---------------------------------------------------------------------------

export async function getQuotePrintModel(id: string): Promise<{ doc: ProfessionalPrintModel; missing: string[] } | null> {
  const q = await db.quote.findUnique({
    where: { id },
    include: {
      items: { where: { removedAt: null }, orderBy: { sortOrder: "asc" } },
      customer: true,
      contact: { select: { name: true, email: true, phone: true } },
      createdBy: { select: { name: true } },
    },
  });
  if (!q) return null;
  const letter = await letterhead(q.settingsVersionId);
  const total = money(q.contractPrice);
  const withholding = snapshotList(q.withholding);
  const prepared = printablePersonName(q.createdBy.name);
  const footer = baseFooter("quote", letter, { thankYou: true, includePayment: true, qr: true });
  const billingAddress = await customerBlockAddress(q.customer);
  const deliveryAddress = await suggestedDeliveryAddress(q.customer);
  const doc: ProfessionalPrintModel = {
    kind: "quote",
    title: "QUOTATION",
    number: q.number,
    date: day(ymd(q.date)),
    status: q.status,
    hideStatus: HIDE_STATUS_ON_PRINT.has("quote"),
    watermark: watermarkForStatus(q.status),
    company: letter.company,
    party: {
      label: "Customer",
      name: q.customer.name,
      tin: q.customer.tin,
      billingAddress,
      deliveryAddress,
      contactPerson: q.contact?.name ?? null,
      phone: q.contact?.phone ?? null,
      email: q.contact?.email ?? null,
    },
    meta: [
      { label: "Valid until", value: day(ymd(q.validUntil)) },
      ...(prepared ? [{ label: "Prepared by", value: prepared }] : []),
    ],
    items: q.items.map((i) => {
      const { description, detail } = splitDescription(i.description);
      return itemRow({
        description,
        detail,
        qty: money(i.qty),
        unit: i.unit,
        unitPrice: money(i.unitPrice),
        amount: money(i.total),
      });
    }),
    unitPriceLabel: "Unit price",
    totals: customerMoneyTotals({
      contractPrice: total,
      withholdingTotal: money(q.withholdingTotal),
      netReceived: money(q.netReceived),
      withholding,
    }),
    totalInWords: amountInWords(total),
    terms: q.terms || letter.print.quoteTerms || null,
    validity: day(ymd(q.validUntil)),
    notes: q.notes,
    deliveryNotes: letter.print.deliveryNotes || null,
    warrantyNotes: letter.print.warrantyNotes || null,
    signatories: customerSignatories(q.createdBy.name),
    ...footer,
    thankYou: true,
  };
  return { doc: await withQr(doc), missing: letter.missing };
}

export async function getSalesOrderPrintModel(id: string): Promise<{ doc: ProfessionalPrintModel; missing: string[] } | null> {
  const so = await db.salesOrder.findUnique({
    where: { id },
    include: {
      items: { where: { removedAt: null }, orderBy: { sortOrder: "asc" } },
      customer: true,
      contact: { select: { name: true, email: true, phone: true } },
      quote: { select: { number: true } },
      createdBy: { select: { name: true } },
    },
  });
  if (!so) return null;
  const letter = await letterhead(so.settingsVersionId);
  const total = money(so.contractPrice);
  const withholding = snapshotList(so.withholding);
  const prepared = printablePersonName(so.createdBy.name);
  const footer = baseFooter("sales_order", letter, { thankYou: true, includePayment: true, qr: true });
  const meta = [
    ...(prepared ? [{ label: "Prepared by", value: prepared }] : []),
    ...(so.buyerPoNo ? [{ label: "Customer PO/ref", value: so.buyerPoNo }] : []),
    ...(so.buyerPoDate ? [{ label: "Customer PO date", value: day(ymd(so.buyerPoDate)) }] : []),
    ...(so.quote ? [{ label: "Quote no.", value: so.quote.number }] : []),
  ];
  const doc: ProfessionalPrintModel = {
    kind: "sales_order",
    title: "SALES ORDER",
    number: so.number,
    date: day(ymd(so.date)),
    status: so.status,
    hideStatus: HIDE_STATUS_ON_PRINT.has("sales_order"),
    watermark: watermarkForStatus(so.status),
    company: letter.company,
    party: {
      label: "Customer",
      name: so.customer.name,
      tin: so.customer.tin,
      billingAddress: await customerBlockAddress(so.customer),
      deliveryAddress: so.deliveryAddress,
      contactPerson: so.contact?.name ?? null,
      phone: so.contact?.phone ?? null,
      email: so.contact?.email ?? null,
    },
    meta,
    items: so.items.map((i) => {
      const { description, detail } = splitDescription(i.description);
      return itemRow({
        description,
        detail,
        qty: money(i.qty),
        unit: i.unit,
        unitPrice: money(i.unitPrice),
        amount: money(i.total),
      });
    }),
    totals: customerMoneyTotals({
      contractPrice: total,
      withholdingTotal: money(so.withholdingTotal),
      netReceived: money(so.netReceived),
      withholding,
    }),
    totalInWords: amountInWords(total),
    terms: so.terms,
    notes: so.notes,
    deliveryNotes: letter.print.deliveryNotes || null,
    warrantyNotes: letter.print.warrantyNotes || null,
    signatories: customerSignatories(so.createdBy.name),
    ...footer,
    thankYou: true,
  };
  return { doc: await withQr(doc), missing: letter.missing };
}

// ---------------------------------------------------------------------------
// Billing / Collection
// ---------------------------------------------------------------------------

export async function getBillingPrintModel(id: string): Promise<{ doc: ProfessionalPrintModel; missing: string[] } | null> {
  const b = await db.billing.findUnique({
    where: { id },
    include: {
      customer: true,
      salesOrder: { select: { number: true, terms: true, buyerPoNo: true } },
      createdBy: { select: { name: true } },
    },
  });
  if (!b) return null;
  const letter = await letterhead();
  const amount = money(b.amount);
  const wh = money(b.withholdingExpected);
  const net = money(b.netExpected);
  const totals: PrintMoneyLine[] = [
    { label: "Subtotal", amount },
  ];
  if (Number(wh) > 0) totals.push({ label: "Less: EWT (expected)", amount: wh });
  totals.push({ label: "Total / Net expected", amount: net, emphasize: true });
  const prepared = printablePersonName(b.createdBy.name);
  const footer = baseFooter("billing", letter, { thankYou: true, includePayment: true });
  const billingAddress = await customerBlockAddress(b.customer);
  const deliveryAddress = await suggestedDeliveryAddress(b.customer);
  const doc: ProfessionalPrintModel = {
    kind: "billing",
    title: "BILLING STATEMENT",
    number: b.number,
    date: day(ymd(b.invoiceDate)),
    status: b.status,
    hideStatus: HIDE_STATUS_ON_PRINT.has("billing"),
    watermark: watermarkForStatus(b.status),
    company: letter.company,
    party: {
      label: "Customer",
      name: b.customer.name,
      tin: b.customer.tin,
      billingAddress,
      deliveryAddress,
      contactPerson: null,
      phone: null,
      email: null,
    },
    meta: [
      { label: "Booklet invoice no.", value: String(b.invoiceNo) },
      { label: "Due date", value: day(ymd(b.dueDate)) },
      { label: "Sales order", value: b.salesOrder.number },
      ...(prepared ? [{ label: "Prepared by", value: prepared }] : []),
      ...(b.salesOrder.buyerPoNo ? [{ label: "Customer PO/ref", value: b.salesOrder.buyerPoNo }] : []),
      ...(b.salesOrder.terms ? [{ label: "Terms", value: b.salesOrder.terms }] : []),
    ],
    items: [
      itemRow({
        description: `Billing for sales order ${b.salesOrder.number} (booklet #${b.invoiceNo})`,
        qty: "1.00",
        unit: "lot",
        unitPrice: amount,
        amount,
      }),
    ],
    totals,
    totalInWords: amountInWords(amount),
    terms: b.salesOrder.terms,
    notes: b.notes,
    signatories: customerSignatories(b.createdBy.name),
    ...footer,
    thankYou: true,
  };
  return { doc, missing: letter.missing };
}

export async function getCollectionPrintModel(id: string): Promise<{ doc: ProfessionalPrintModel; missing: string[] } | null> {
  const c = await db.collection.findUnique({
    where: { id },
    include: {
      customer: true,
      cashAccount: { select: { name: true } },
      allocations: {
        include: { billing: { select: { number: true, invoiceNo: true } } },
      },
      createdBy: { select: { name: true } },
    },
  });
  if (!c) return null;
  const letter = await letterhead();
  const received = money(c.amountReceived);
  const whTotal = money(
    c.allocations.reduce((a, x) => a + Number(money(x.withholdingApplied)), 0).toFixed(2),
  );
  const totals: PrintMoneyLine[] = [{ label: "Amount received", amount: received, emphasize: true }];
  if (Number(whTotal) > 0) totals.unshift({ label: "EWT (2307) applied", amount: whTotal });
  const footer = baseFooter("collection", letter, { thankYou: true });
  const refs = c.allocations.map((a) => `BL ${a.billing.number} / booklet #${a.billing.invoiceNo}`);
  const doc: ProfessionalPrintModel = {
    kind: "collection",
    title: "Collection Acknowledgement",
    number: c.number,
    date: day(ymd(c.date)),
    status: c.status,
    watermark: watermarkForStatus(c.status),
    company: letter.company,
    party: {
      label: "Customer",
      name: c.customer.name,
      tin: c.customer.tin,
      billingAddress: await customerBlockAddress(c.customer),
      deliveryAddress: null,
      contactPerson: null,
      phone: null,
      email: null,
    },
    meta: [
      { label: "Method", value: COLLECTION_METHOD_LABELS[c.method as keyof typeof COLLECTION_METHOD_LABELS] ?? c.method },
      ...(c.receiptNo ? [{ label: "Receipt no.", value: c.receiptNo }] : []),
      ...(c.reference ? [{ label: "Reference", value: c.reference }] : []),
      ...(refs.length ? [{ label: "Applied to", value: refs.join(", ")}] : []),
      ...(c.cashAccount ? [{ label: "Deposited to", value: c.cashAccount.name }] : []),
    ],
    items: [
      itemRow({
        description: `Collection acknowledgement${c.receiptNo ? ` · OR/AR ${c.receiptNo}` : ""}`,
        qty: "1.00",
        unit: "lot",
        unitPrice: received,
        amount: received,
      }),
    ],
    totals,
    totalInWords: amountInWords(received),
    notes: c.notes,
    ewtNote: Number(whTotal) > 0 ? EWT_2307_NOTE : null,
    signatories: [
      { role: "Prepared by", name: c.createdBy.name },
      { role: "Received by", name: null },
    ],
    ...footer,
    thankYou: true,
  };
  return { doc, missing: letter.missing };
}

// ---------------------------------------------------------------------------
// Supplier PO / Receiving report
// ---------------------------------------------------------------------------

export async function getPurchaseOrderPrintModel(
  id: string,
  viewer: PermissionUser,
): Promise<{ doc: ProfessionalPrintModel; missing: string[] } | null> {
  assertCosts(viewer);
  const po = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      supplierContact: { select: { name: true, email: true, phone: true } },
      salesOrder: { select: { number: true } },
      items: { where: { removedAt: null }, orderBy: { sortOrder: "asc" } },
      createdBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
    },
  });
  if (!po) return null;
  const letter = await letterhead();
  const total = money(po.subtotal);
  const footer = baseFooter("supplier_po", letter, {});
  const doc: ProfessionalPrintModel = {
    kind: "supplier_po",
    title: "Purchase Order",
    number: po.revision > 1 ? `${po.number} (rev. ${po.revision})` : po.number,
    date: day(ymd(po.date)),
    status: po.status,
    watermark: watermarkForStatus(po.status),
    company: letter.company,
    party: {
      label: "Supplier",
      name: po.supplier.name,
      tin: po.supplier.tin,
      billingAddress: po.supplierAddressText,
      deliveryAddress: po.deliveryAddressText,
      contactPerson: po.supplierContact?.name ?? null,
      phone: po.supplierContact?.phone ?? null,
      email: po.supplierContact?.email ?? null,
    },
    meta: [
      ...(po.expectedDate ? [{ label: "Expected delivery", value: day(ymd(po.expectedDate)) }] : []),
      ...(po.salesOrder ? [{ label: "Our SO ref.", value: po.salesOrder.number }] : []),
      ...(po.terms ? [{ label: "Terms", value: po.terms }] : []),
    ],
    items: po.items.map((i) =>
      itemRow({
        description: i.description,
        qty: money(i.qty),
        unit: i.unit,
        unitPrice: money(i.unitCost),
        amount: money(i.total),
      }),
    ),
    unitPriceLabel: "Unit cost",
    totals: moneyTotals(total),
    totalInWords: amountInWords(total),
    terms: po.terms,
    notes: po.notes,
    deliveryNotes: letter.print.deliveryNotes || null,
    signatories: [
      { role: "Prepared by", name: po.createdBy.name },
      { role: "Approved by", name: po.approvedBy?.name ?? null },
      { role: "Received by", name: null },
    ],
    ...footer,
  };
  return { doc, missing: letter.missing };
}

export async function getReceivingReportPrintModel(
  id: string,
  viewer: PermissionUser,
): Promise<{ doc: ProfessionalPrintModel; missing: string[]; purchaseOrderId: string } | null> {
  const rr = await db.receivingReport.findUnique({
    where: { id },
    include: {
      purchaseOrder: {
        include: {
          supplier: true,
          salesOrder: { select: { number: true } },
          items: { where: { removedAt: null }, select: { id: true, description: true, unit: true, unitCost: true } },
        },
      },
      items: true,
      receivedBy: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
  });
  if (!rr) return null;
  const letter = await letterhead();
  // Costs only when the print setting is ON *and* the viewer may see costs.
  const showCosts = !!letter.print.showReceivingReportCosts && canSeeCosts(viewer);
  const byId = new Map(rr.purchaseOrder.items.map((i) => [i.id, i]));
  const items = rr.items.map((x) => {
    const poItem = byId.get(x.purchaseOrderItemId);
    const qty = money(x.qtyReceived);
    const unitCost = showCosts && poItem ? money(poItem.unitCost) : "0.00";
    const amount = showCosts ? (Number(qty) * Number(unitCost)).toFixed(2) : "0.00";
    return itemRow({
      description: poItem?.description ?? "(removed line)",
      qty,
      unit: poItem?.unit ?? "pc",
      unitPrice: unitCost,
      amount,
    });
  });
  const subtotal = items.reduce((a, i) => a + Number(i.amount), 0).toFixed(2);
  const footer = baseFooter("receiving_report", letter, {});
  const doc: ProfessionalPrintModel = {
    kind: "receiving_report",
    title: "Receiving Report",
    number: rr.number,
    date: day(ymd(rr.receivedDate)),
    status: rr.status,
    watermark: watermarkForStatus(rr.status),
    company: letter.company,
    party: {
      label: "Supplier",
      name: rr.purchaseOrder.supplier.name,
      tin: rr.purchaseOrder.supplier.tin,
      billingAddress: null,
      deliveryAddress: rr.purchaseOrder.deliveryAddressText,
      contactPerson: null,
      phone: null,
      email: null,
    },
    meta: [
      { label: "PO no.", value: rr.purchaseOrder.number },
      ...(rr.purchaseOrder.salesOrder ? [{ label: "Our SO ref.", value: rr.purchaseOrder.salesOrder.number }] : []),
      ...(rr.deliveryRef ? [{ label: "Delivery ref.", value: rr.deliveryRef }] : []),
      { label: "Received by", value: rr.receivedBy.name },
    ],
    items,
    hideLineAmounts: !showCosts,
    unitPriceLabel: showCosts ? "Unit cost" : undefined,
    totals: showCosts ? moneyTotals(subtotal) : undefined,
    totalInWords: showCosts ? amountInWords(subtotal) : undefined,
    notes: rr.notes,
    signatories: [
      { role: "Prepared by", name: rr.createdBy.name },
      { role: "Received by", name: rr.receivedBy.name },
      { role: "Approved by", name: null },
    ],
    ...footer,
  };
  return { doc, missing: letter.missing, purchaseOrderId: rr.purchaseOrderId };
}

// ---------------------------------------------------------------------------
// Supplier payment / Expense
// ---------------------------------------------------------------------------

export async function getSupplierPaymentPrintModel(
  id: string,
  viewer: PermissionUser,
): Promise<{ doc: ProfessionalPrintModel; missing: string[] } | null> {
  assertCosts(viewer);
  const p = await db.supplierPayment.findUnique({
    where: { id },
    include: {
      supplier: true,
      cashAccount: { select: { name: true } },
      allocations: {
        include: { supplierBill: { select: { billNumber: true } } },
      },
      withholdings: true,
      createdBy: { select: { name: true } },
    },
  });
  if (!p) return null;
  const letter = await letterhead();
  const paid = money(p.amountPaid);
  const ewt = p.allocations.reduce((a, x) => a + Number(money(x.withholdingApplied)), 0);
  const ewtStr = ewt.toFixed(2);
  const totals: PrintMoneyLine[] = [{ label: "Amount paid", amount: paid }];
  if (ewt > 0) {
    totals.push({ label: "EWT withheld", amount: ewtStr });
    totals.push({ label: "Total applied (cash + EWT)", amount: (Number(paid) + ewt).toFixed(2), emphasize: true });
  } else {
    totals[0] = { label: "Total", amount: paid, emphasize: true };
  }
  const footer = baseFooter("supplier_payment", letter, {});
  const billRefs = p.allocations.map((a) => `Bill ${a.supplierBill.billNumber}`);
  const doc: ProfessionalPrintModel = {
    kind: "supplier_payment",
    title: "Supplier Payment Voucher",
    number: p.number,
    date: day(ymd(p.date)),
    status: p.status,
    watermark: watermarkForStatus(p.status),
    company: letter.company,
    party: {
      label: "Supplier",
      name: p.supplier.name,
      tin: p.supplier.tin,
      billingAddress: null,
      deliveryAddress: null,
      contactPerson: null,
      phone: null,
      email: null,
    },
    meta: [
      { label: "Method", value: p.method },
      ...(p.reference ? [{ label: "Reference", value: p.reference }] : []),
      ...(p.cashAccount ? [{ label: "Paid from", value: p.cashAccount.name }] : []),
      ...(billRefs.length ? [{ label: "Bills", value: billRefs.join(", ") }] : []),
    ],
    items: p.allocations.map((a) =>
      itemRow({
        description: `Payment for bill ${a.supplierBill.billNumber}`,
        qty: "1.00",
        unit: "lot",
        unitPrice: money(a.cashApplied),
        amount: money(a.cashApplied),
      }),
    ),
    totals,
    totalInWords: amountInWords(paid),
    notes: p.notes,
    ewtNote: ewt > 0 ? EWT_2307_NOTE : null,
    signatories: [
      { role: "Prepared by", name: p.createdBy.name },
      { role: "Approved by", name: null },
      { role: "Received by", name: null },
    ],
    ...footer,
  };
  return { doc, missing: letter.missing };
}

export async function getExpensePrintModel(
  id: string,
  viewer: PermissionUser,
): Promise<{ doc: ProfessionalPrintModel; missing: string[] } | null> {
  assertCosts(viewer);
  const e = await db.expense.findUnique({
    where: { id },
    include: {
      supplier: true,
      category: true,
      cashAccount: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
  });
  if (!e) return null;
  const letter = await letterhead();
  const amount = money(e.amount);
  const wh = money(e.withholdingApplied);
  const totals: PrintMoneyLine[] = [{ label: "Amount", amount }];
  if (Number(wh) > 0) {
    totals.push({ label: "EWT withheld", amount: wh });
    totals.push({ label: "Net cash out", amount: (Number(amount) - Number(wh)).toFixed(2), emphasize: true });
  } else {
    totals[0] = { label: "Total", amount, emphasize: true };
  }
  const payeeName = e.supplier?.name ?? e.payeeText ?? "—";
  const footer = baseFooter("expense", letter, {});
  const doc: ProfessionalPrintModel = {
    kind: "expense",
    title: "Expense Voucher",
    number: e.number,
    date: day(ymd(e.date)),
    status: e.status,
    watermark: watermarkForStatus(e.status),
    company: letter.company,
    party: {
      label: "Payee",
      name: payeeName,
      tin: e.supplier?.tin ?? null,
      billingAddress: null,
      deliveryAddress: null,
      contactPerson: null,
      phone: null,
      email: null,
    },
    meta: [
      { label: "Category", value: e.category.label },
      { label: "Paid from", value: e.cashAccount.name },
      ...(e.receiptNo ? [{ label: "Receipt no.", value: e.receiptNo }] : []),
    ],
    items: [
      itemRow({
        description: e.notes?.trim() || e.category.label,
        qty: "1.00",
        unit: "lot",
        unitPrice: amount,
        amount,
      }),
    ],
    totals,
    totalInWords: amountInWords(amount),
    notes: e.notes,
    ewtNote: Number(wh) > 0 ? EWT_2307_NOTE : null,
    signatories: [
      { role: "Prepared by", name: e.createdBy.name },
      { role: "Approved by", name: null },
      { role: "Received by", name: null },
    ],
    ...footer,
  };
  return { doc, missing: letter.missing };
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

export async function getCustomerStatementPrintModel(
  customerId: string,
  from?: Date | null,
  to?: Date | null,
): Promise<{ doc: ProfessionalPrintModel; missing: string[] } | null> {
  const stmt = await getStatement(customerId, from, to);
  if (!stmt) return null;
  const letter = await letterhead();
  const footer = baseFooter("customer_statement", letter, { thankYou: true, includePayment: true });
  const aging = AGING_BUCKETS.map((b) => ({ label: AGING_BUCKET_LABELS[b], amount: stmt.aging[b] }));
  const doc: ProfessionalPrintModel = {
    kind: "customer_statement",
    title: "Statement of Account",
    number: stmt.customer.name,
    date: day(ymd(new Date())),
    status: "OPEN",
    watermark: null,
    company: letter.company,
    party: {
      label: "Customer",
      name: stmt.customer.name,
      tin: stmt.customer.tin,
      billingAddress: stmt.customer.address,
      deliveryAddress: null,
      contactPerson: null,
      phone: null,
      email: null,
    },
    meta: [
      ...(stmt.from || stmt.to
        ? [{ label: "Period", value: `${day(stmt.from)} – ${day(stmt.to)}` }]
        : []),
    ],
    ledger: {
      openingBalance: stmt.openingBalance,
      closingBalance: stmt.closingBalance,
      aging,
      lines: stmt.lines.map((line) => {
        if (line.kind === "billing") {
          return {
            date: day(line.date),
            description: `Booklet invoice #${line.invoiceNo} · due ${day(line.dueDate)}`,
            charges: line.amount,
            credits: null,
            balance: line.runningBalance,
          };
        }
        const method = COLLECTION_METHOD_LABELS[line.method as keyof typeof COLLECTION_METHOD_LABELS] ?? line.method;
        const credit = (Number(line.cash) + Number(line.withholding) + Number(line.unapplied)).toFixed(2);
        return {
          date: day(line.date),
          description: `Collection · ${method}${line.receiptNo ? ` · ${line.receiptNo}` : ""}`,
          charges: null,
          credits: credit,
          balance: line.runningBalance,
        };
      }),
    },
    totalInWords: amountInWords(stmt.closingBalance),
    signatories: [
      { role: "Prepared by", name: null },
      { role: "Approved by", name: null },
    ],
    ...footer,
    thankYou: true,
  };
  return { doc, missing: letter.missing };
}

export async function getSupplierStatementPrintModel(
  supplierId: string,
  viewer: PermissionUser,
): Promise<{ doc: ProfessionalPrintModel; missing: string[] } | null> {
  assertCosts(viewer);
  const supplier = await db.supplier.findUnique({
    where: { id: supplierId },
    include: {
      addresses: { where: { archivedAt: null, kind: "BILLING" }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], take: 1 },
    },
  });
  if (!supplier) return null;
  const letter = await letterhead();
  const bills = await db.supplierBill.findMany({
    where: { supplierId, status: { not: "VOID" } },
    include: { allocations: { where: { supplierPayment: { status: "POSTED" } } } },
    orderBy: [{ billDate: "asc" }, { createdAt: "asc" }],
  });
  const payments = await db.supplierPayment.findMany({
    where: { supplierId, status: "POSTED" },
    include: { allocations: true },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });

  type Line =
    | { kind: "bill"; date: string; label: string; amount: string; id: string }
    | { kind: "payment"; date: string; label: string; cash: string; ewt: string; id: string };

  const lines: Line[] = [];
  for (const b of bills) {
    lines.push({
      kind: "bill",
      date: ymd(b.billDate)!,
      label: `Bill ${b.billNumber}`,
      amount: money(b.amount),
      id: b.id,
    });
  }
  for (const p of payments) {
    const cash = p.allocations.reduce((a, x) => a + Number(money(x.cashApplied)), 0).toFixed(2);
    const ewt = p.allocations.reduce((a, x) => a + Number(money(x.withholdingApplied)), 0).toFixed(2);
    lines.push({
      kind: "payment",
      date: ymd(p.date)!,
      label: `Payment ${p.number}`,
      cash,
      ewt,
      id: p.id,
    });
  }
  lines.sort((a, b) => a.date.localeCompare(b.date));

  let running = 0;
  const ledgerLines = lines.map((line) => {
    if (line.kind === "bill") running += Number(line.amount);
    else running -= Number(line.cash) + Number(line.ewt);
    return {
      date: day(line.date),
      description: line.label,
      charges: line.kind === "bill" ? line.amount : null,
      credits: line.kind === "payment" ? (Number(line.cash) + Number(line.ewt)).toFixed(2) : null,
      balance: running.toFixed(2),
    };
  });

  const address = supplier.addresses[0] ? formatAddress(supplier.addresses[0]) : supplier.address;
  const footer = baseFooter("supplier_statement", letter, {});
  const closing = running.toFixed(2);
  const doc: ProfessionalPrintModel = {
    kind: "supplier_statement",
    title: "Supplier Statement of Account",
    number: supplier.name,
    date: day(ymd(new Date())),
    status: "OPEN",
    watermark: null,
    company: letter.company,
    party: {
      label: "Supplier",
      name: supplier.name,
      tin: supplier.tin,
      billingAddress: address,
      deliveryAddress: null,
      contactPerson: null,
      phone: null,
      email: null,
    },
    meta: [],
    ledger: {
      openingBalance: "0.00",
      closingBalance: closing,
      lines: ledgerLines,
    },
    totalInWords: amountInWords(closing),
    signatories: [
      { role: "Prepared by", name: null },
      { role: "Approved by", name: null },
    ],
    ...footer,
  };
  return { doc, missing: letter.missing };
}

/** Re-export thank-you constant for tests that assert customer copy. */
export { THANK_YOU };
