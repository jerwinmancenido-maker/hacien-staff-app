// Store-order conversion (store intake Slice 2, HIGH RISK — money).
//
// One transaction turns a PAID store order into the full document chain:
// customer (confirmed / picked / created, with the buyer's Contact and
// delivery Address) → Sales Order → Billing → Collection allocated in
// full. It composes the same tx-shaped helpers recordBilling and
// recordCollection use (booklet lock + claim, allocateDocNumber,
// recomputeBillingStatus) instead of calling those services wholesale —
// they assert their own preconditions and open their own transactions.
//
// The store SO has no quote (Gap 1: SalesOrder.quoteId is nullable). Its
// acceptance evidence is the verified gateway payment: the SO notes and
// the conversion audit row record the store-order number, the gateway
// and the payment reference; buyerPoNo stays null.
//
// Figures: SO contractPrice = netReceived = the amount paid, exactly —
// the delivery fee rides as a final SO line so SO total = billing =
// collection = amountPaid to the centavo. No withholding, ever (a web
// buyer is not a withholding agent). The CURRENT settings snapshot is
// pinned, the way a quote conversion pins the quote's.
//
// The gateway fee IS expensed here (Gap 7 follow-up, 2026-11-27):
// Expense.cashAccountId is nullable, and the fee — withheld from
// settlement, never paid out of an account — is recorded inside this
// same transaction as an account-less expense linked to the SO
// (plan §10 ABSORB ruling: fee = data + an order-linked expense,
// never a customer-facing line). An account-less expense counts in
// expense/profit reporting but touches no cash balance or position.

import type { Prisma } from "@prisma/client";
import { db, type Tx } from "../db";
import { writeAudit } from "../audit";
import { assertCan, staffNeedsAdminCheck, type PermissionUser } from "../permissions";
import { getSettingsSnapshot } from "../settings";
import { allocateDocNumber, ensureSeries } from "../documents/series";
import { DocRuleError, DOC_TX, money, withTxRetry, ymd } from "../documents/common";
import { docTotals, lineAmounts, type LineForDocTotals } from "../quotes/calc";
import { bookletRangeError, formatBookletNumber } from "../billing/booklet";
import { netExpected, proRataWithholding } from "../billing/status";
import { claimBookletSerial, lockSiBookletNumber } from "../services/booklet";
import { recomputeBillingStatus } from "../services/billings";
import { assertPeriodOpen } from "../services/period-close";
import { defaultExpenseCategoryId } from "../services/expenses";
import { generateUniqueTrackingRef } from "../tracking-ref";
import { formatAddress } from "../addresses/format";
import { normalizeDescription } from "../items/history";
import { manilaToday } from "../format";

export type ConvertStoreOrderInput = {
  /** matched = the intake proposal; existing = staff pick; new = create from the buyer details. */
  customerMode: "matched" | "existing" | "new";
  customerId?: string | null;
  /** Create-new only: the buyer is an individual, not a company. */
  isIndividual?: boolean;
  /** Booklet SI serial (Gap 2): required staff input, claimed in-transaction. */
  invoiceNo: number;
  /** Flagged lines only: storeOrderLineId → catalogue item id, or null = keep as free text. */
  lineItemPicks?: Record<string, string | null>;
};

export type StoreOrderConvertActor = PermissionUser & { id: string };

/**
 * The last PO cost for a catalogue item, from the same source the quote
 * editor's auto-fill uses (non-VOID PO lines whose description matches
 * the item name exactly, newest PO first). Null = no cost history: the
 * line converts with cost 0 and the dialog has already shown that.
 */
async function lastPoCost(
  tx: Tx,
  itemName: string,
): Promise<{ supplierId: string; unitCost: string } | null> {
  const want = normalizeDescription(itemName);
  if (!want) return null;
  const lines = await tx.purchaseOrderItem.findMany({
    where: {
      description: { contains: itemName.trim() },
      purchaseOrder: { status: { not: "VOID" } },
    },
    select: {
      description: true,
      unitCost: true,
      purchaseOrder: { select: { supplierId: true } },
    },
    orderBy: [{ purchaseOrder: { date: "desc" } }],
    take: 200,
  });
  const hit = lines.find((l) => normalizeDescription(l.description) === want);
  if (!hit) return null;
  return { supplierId: hit.purchaseOrder.supplierId, unitCost: money(hit.unitCost) };
}

export async function convertStoreOrder(id: string, input: ConvertStoreOrderInput, actor: StoreOrderConvertActor) {
  assertCan(actor, "approve");

  const existing = await db.storeOrder.findUnique({
    where: { id },
    select: { id: true, status: true, gatewayFee: true, gatewayName: true },
  });
  if (!existing) throw new DocRuleError("Store order not found.");
  if (existing.status !== "PAID") {
    throw new DocRuleError("This store order was already converted or is no longer awaiting conversion.");
  }

  const snap = await getSettingsSnapshot();
  const range = snap.settings.invoiceBooklet.salesInvoice ?? snap.settings.invoiceBooklet;
  const rangeErr = bookletRangeError(input.invoiceNo, range);
  if (rangeErr) throw new DocRuleError(rangeErr, "invoiceNo");

  // Conversion is dated today (Manila), like the payment it books.
  const date = manilaToday();
  const year = date.getUTCFullYear();
  const soFormat = snap.settings.numbering.salesOrder;
  const billingFormat = snap.settings.numbering.billing;
  const collectionFormat = snap.settings.numbering.collection;
  const expenseFormat = snap.settings.numbering.expense;
  await ensureSeries(db, "SALES_ORDER", year, soFormat);
  await ensureSeries(db, "BILLING", year, billingFormat);
  await ensureSeries(db, "COLLECTION", year, collectionFormat);
  await ensureSeries(db, "EXPENSE", year, expenseFormat);

  // Gateway fee expense category (Gap 7): the category named
  // "Gateway fees" when an Admin has created one, else the house
  // default. Resolved before the transaction so a missing category
  // refuses the conversion cleanly, before anything is written.
  const gatewayFee = money(existing.gatewayFee);
  let feeCategory: { id: string; label: string } | null = null;
  if (gatewayFee !== "0.00") {
    feeCategory = await db.expenseCategory.findFirst({
      where: { label: "Gateway fees", active: true },
      select: { id: true, label: true },
      orderBy: { createdAt: "asc" },
    });
    if (!feeCategory) {
      const fallbackId = await defaultExpenseCategoryId();
      if (fallbackId) {
        feeCategory = await db.expenseCategory.findUnique({
          where: { id: fallbackId },
          select: { id: true, label: true },
        });
      }
    }
    if (!feeCategory) {
      throw new DocRuleError(
        "No active expense category exists, so the gateway fee cannot be expensed. Add an expense category under Cash first.",
      );
    }
  }

  const picks = input.lineItemPicks ?? {};

  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      // Lock the store order row: a second conversion (double click, two
      // staff) waits here, then fails the status check — double-convert
      // is impossible.
      const locked = await tx.$queryRaw<{ status: string }[]>`SELECT \`status\` FROM \`StoreOrder\` WHERE \`id\` = ${id} FOR UPDATE`;
      if (!locked.length) throw new DocRuleError("Store order not found.");
      if (locked[0]!.status !== "PAID") {
        throw new DocRuleError("This store order was already converted or is no longer awaiting conversion.");
      }
      const order = await tx.storeOrder.findUniqueOrThrow({
        where: { id },
        include: {
          lines: {
            orderBy: { sortOrder: "asc" },
            include: { item: { select: { id: true, name: true, kind: true, unit: true, active: true } } },
          },
        },
      });
      await assertPeriodOpen(tx, date);

      // --- Booklet SI (Gap 2): lock, prove unused, claim — the exact
      // sequence recordBilling runs. A collision aborts the whole
      // conversion: no SO, no billing, no customer, no claim survives.
      await lockSiBookletNumber(tx, input.invoiceNo);
      const taken = await tx.billing.findFirst({ where: { invoiceNo: input.invoiceNo }, select: { id: true } });
      const spoiled = await tx.spoiledBookletNumber.findFirst({ where: { type: "SI", number: input.invoiceNo }, select: { id: true } });
      if (taken || spoiled) {
        throw new DocRuleError(`SI no. ${formatBookletNumber(input.invoiceNo)} is already used / marked spoiled.`, "invoiceNo");
      }
      await claimBookletSerial(tx, "SI", input.invoiceNo);

      // --- Customer: confirm the proposal, take the staff pick, or
      // create from the buyer details (no TIN, explicit no-withholding).
      let customer: { id: string; name: string; defaultTerms: string | null };
      if (input.customerMode === "new") {
        const created = await tx.customer.create({
          data: {
            name: order.buyerName,
            tin: null,
            withholdingType: "NONE",
            defaultWithholding: [] as Prisma.InputJsonValue,
            defaultTerms: null,
            creditLimit: null,
            notes: null,
            isIndividual: input.isIndividual === true,
          },
          select: { id: true, name: true, defaultTerms: true },
        });
        customer = created;
        await writeAudit(tx, {
          userId: actor.id,
          entityType: "Customer",
          entityId: created.id,
          action: "create",
          after: { name: created.name, source: `Store order ${order.number}` },
        });
      } else {
        const customerId = input.customerMode === "matched" ? order.matchedCustomerId : input.customerId;
        if (!customerId) {
          throw new DocRuleError(
            input.customerMode === "matched"
              ? "No customer match was proposed for this order — pick a customer or create one."
              : "Pick the customer for this order.",
            "customerId",
          );
        }
        const found = await tx.customer.findUnique({
          where: { id: customerId },
          select: { id: true, name: true, defaultTerms: true, active: true },
        });
        if (!found || !found.active) throw new DocRuleError("That customer no longer exists or is inactive.", "customerId");
        customer = found;
      }

      // --- Buyer contact + delivery address under the customer
      // (find-or-create, so a repeat web buyer doesn't pile up copies).
      let contact = order.buyerEmail
        ? await tx.contact.findFirst({
            where: { customerId: customer.id, email: order.buyerEmail, archivedAt: null },
            select: { id: true },
          })
        : null;
      if (!contact) {
        const mainCount = await tx.contact.count({ where: { customerId: customer.id, isMain: true, archivedAt: null } });
        contact = await tx.contact.create({
          data: {
            customerId: customer.id,
            name: order.buyerName,
            email: order.buyerEmail || null,
            phone: order.buyerPhone || null,
            isMain: mainCount === 0,
          },
          select: { id: true },
        });
      }
      let address = await tx.address.findFirst({
        where: { customerId: customer.id, kind: "DELIVERY", street: order.addressStreet, archivedAt: null },
        select: { id: true, label: true, street: true, barangay: true, cityMunicipality: true, province: true, zip: true },
      });
      if (!address) {
        const addressCount = await tx.address.count({ where: { customerId: customer.id, archivedAt: null } });
        address = await tx.address.create({
          data: {
            customerId: customer.id,
            kind: "DELIVERY",
            label: order.addressLabel,
            street: order.addressStreet,
            barangay: order.addressBarangay ?? "",
            cityMunicipality: order.addressCityMunicipality ?? "",
            province: order.addressProvince ?? "",
            zip: order.addressZip ?? "",
            isDefault: addressCount === 0,
          },
          select: { id: true, label: true, street: true, barangay: true, cityMunicipality: true, province: true, zip: true },
        });
      }

      // --- SO lines: mapped lines take the catalogue item's name; a
      // flagged line takes the staff pick (an item, or free text = the
      // title as sent). Supplier cost from the last-PO-cost auto-fill
      // source; no history → cost 0 (the dialog showed which lines).
      type BuiltLine = {
        sortOrder: number;
        description: string;
        kind: "GOODS" | "SERVICES";
        qty: string;
        unit: string;
        supplierId: string | null;
        supplierUnitCost: string;
        unitPrice: string;
        total: string;
        supplierTotal: string;
        margin: string;
      };
      const built: BuiltLine[] = [];
      const totalsLines: LineForDocTotals[] = [];
      for (const line of order.lines) {
        const mapped = line.item && line.item.active ? line.item : null;
        let item: { id: string; name: string; kind: "GOODS" | "SERVICES"; unit: string } | null = mapped;
        if (!item) {
          if (!Object.prototype.hasOwnProperty.call(picks, line.id)) {
            throw new DocRuleError(
              `Resolve the catalogue match for “${line.title}” — pick an item or keep it as free text.`,
              "lineItemPicks",
            );
          }
          const pickId = picks[line.id];
          if (pickId) {
            const picked = await tx.item.findUnique({
              where: { id: pickId },
              select: { id: true, name: true, kind: true, unit: true, active: true },
            });
            if (!picked || !picked.active) {
              throw new DocRuleError(`The item picked for “${line.title}” no longer exists or is inactive.`, "lineItemPicks");
            }
            item = picked;
          }
        }
        const cost = item ? await lastPoCost(tx, item.name) : null;
        const lineInput = {
          kind: item?.kind ?? ("GOODS" as const),
          qty: money(line.qty),
          unitPrice: money(line.unitPrice),
          supplierUnitCost: cost?.unitCost ?? "0",
        };
        const amounts = lineAmounts(lineInput);
        built.push({
          sortOrder: line.sortOrder,
          description: item ? item.name : line.title,
          kind: lineInput.kind,
          qty: lineInput.qty,
          unit: item ? item.unit : line.unit,
          supplierId: cost?.supplierId ?? null,
          supplierUnitCost: cost?.unitCost ?? "0",
          unitPrice: lineInput.unitPrice,
          total: amounts.total,
          supplierTotal: amounts.supplierTotal,
          margin: amounts.margin,
        });
        totalsLines.push(lineInput);
      }
      // Delivery fee as a final line, so the SO total is the amount paid.
      const deliveryFee = money(order.deliveryFee);
      if (deliveryFee !== "0.00") {
        const feeInput = { kind: "SERVICES" as const, qty: "1", unitPrice: deliveryFee, supplierUnitCost: "0" };
        const amounts = lineAmounts(feeInput);
        built.push({
          sortOrder: built.length + 1,
          description: "Delivery fee",
          kind: "SERVICES",
          qty: "1",
          unit: "service",
          supplierId: null,
          supplierUnitCost: "0",
          unitPrice: deliveryFee,
          total: amounts.total,
          supplierTotal: amounts.supplierTotal,
          margin: amounts.margin,
        });
        totalsLines.push(feeInput);
      }

      const totals = docTotals(totalsLines);
      const amountPaid = money(order.amountPaid);
      if (totals.contractPrice !== amountPaid) {
        // The intake amount rule (Σ lines + deliveryFee = amountPaid)
        // makes this unreachable; if it ever fires, nothing may land.
        throw new DocRuleError("The converted total does not match the amount paid — conversion stopped, nothing was recorded.");
      }

      // --- Sales Order (quote-less; the verified gateway payment is the
      // acceptance evidence, recorded in the notes + the audit below).
      const soNumber = await allocateDocNumber(tx, "SALES_ORDER", year, soFormat);
      const trackingRef = await generateUniqueTrackingRef(
        async (ref) => !!(await tx.salesOrder.findUnique({ where: { trackingRef: ref }, select: { id: true } })),
      );
      const so = await tx.salesOrder.create({
        data: {
          number: soNumber,
          trackingRef,
          quoteId: null,
          businessId: null,
          customerId: customer.id,
          contactId: contact.id,
          date,
          buyerPoNo: null,
          buyerPoDate: null,
          deliveryAddress: formatAddress(address, { multiline: true }),
          terms: customer.defaultTerms ?? null,
          notes: `Web order ${order.number} — paid via ${order.gatewayName}, payment ref ${order.gatewayPaymentRef}.`,
          settingsVersionId: snap.versionId,
          withholding: totals.withholding as unknown as Prisma.InputJsonValue,
          contractPrice: totals.contractPrice,
          withholdingTotal: totals.withholdingTotal,
          netReceived: totals.netReceived,
          supplierCost: totals.supplierCost,
          netMargin: totals.netMargin,
          netMarginPct: totals.netMarginPct,
          createdById: actor.id,
          updatedById: actor.id,
          items: {
            create: built.map((l) => ({
              sortOrder: l.sortOrder,
              quoteItemId: null,
              description: l.description,
              kind: l.kind,
              qty: l.qty,
              unit: l.unit,
              supplierId: l.supplierId,
              supplierUnitCost: l.supplierUnitCost,
              unitPrice: l.unitPrice,
              total: l.total,
              supplierTotal: l.supplierTotal,
              margin: l.margin,
              isLot: false,
            })),
          },
        },
      });
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "SalesOrder",
        entityId: so.id,
        action: "create",
        after: {
          number: soNumber,
          customer: customer.name,
          date: ymd(date),
          contractPrice: totals.contractPrice,
          source: `Store order ${order.number}`,
          paymentRef: order.gatewayPaymentRef,
        },
      });

      // --- Billing for the full amount, on the claimed booklet SI.
      // No withholding forecast (ERP payment-entry model, 2026-11-28):
      // withholdingBreakdown stays unset and the expected figure is a
      // literal 0 — a store SO's withholding total is 0.00 by
      // construction, and new billings no longer derive a forecast.
      const withholdingExpected = "0.00";
      const net = netExpected(amountPaid, withholdingExpected);
      const billingNumber = await allocateDocNumber(tx, "BILLING", year, billingFormat);
      const billing = await tx.billing.create({
        data: {
          number: billingNumber,
          salesOrderId: so.id,
          customerId: customer.id,
          invoiceNo: input.invoiceNo,
          invoiceDate: date,
          dueDate: date,
          amount: amountPaid,
          withholdingExpected,
          netExpected: net,
          status: "OPEN",
          notes: null,
          needsAdminCheck: staffNeedsAdminCheck(actor),
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "Billing",
        entityId: billing.id,
        action: "create",
        after: {
          number: billingNumber,
          salesOrder: soNumber,
          invoiceNo: input.invoiceNo,
          invoiceDate: ymd(date),
          dueDate: ymd(date),
          amount: amountPaid,
          withholdingExpected,
          netExpected: net,
        },
      });

      // --- Collection: the gateway payment, allocated in full, no cash
      // account (settlement lands later — the same "Not assigned" state
      // a deposit collection starts in).
      const collectionNumber = await allocateDocNumber(tx, "COLLECTION", year, collectionFormat);
      const collection = await tx.collection.create({
        data: {
          number: collectionNumber,
          customerId: customer.id,
          date,
          method: "GATEWAY",
          reference: order.gatewayPaymentRef,
          checkBank: null,
          checkDate: null,
          receiptNo: null,
          amountReceived: amountPaid,
          cashAccountId: null,
          notes: `Web order ${order.number} via ${order.gatewayName}`,
          isDeposit: false,
          needsAdminCheck: staffNeedsAdminCheck(actor),
          createdById: actor.id,
        },
      });
      await tx.collectionAllocation.create({
        data: {
          collectionId: collection.id,
          billingId: billing.id,
          cashApplied: amountPaid,
          withholdingApplied: "0.00",
          appliedOn: date,
        },
      });
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "Collection",
        entityId: collection.id,
        action: "create",
        after: {
          number: collectionNumber,
          customer: customer.name,
          date: ymd(date),
          method: "GATEWAY",
          reference: order.gatewayPaymentRef,
          amountReceived: amountPaid,
          allocations: [{ billing: billingNumber, cashApplied: amountPaid, withholdingApplied: "0.00" }],
        },
      });
      // Flips the billing to PAID and refreshes the SO close state.
      await recomputeBillingStatus(tx, billing.id, actor.id);

      // --- Gateway fee expense (Gap 7): the fee was withheld from
      // settlement, so the expense is account-less - it counts in
      // expense/profit reporting but touches no cash balance or
      // position. Linked to the SO (Slice 3 refund mirror voids it
      // through voidExpense). Never on any customer document: it is
      // not an SO line and appears on no billing or print.
      let feeExpenseNumber: string | null = null;
      if (feeCategory) {
        feeExpenseNumber = await allocateDocNumber(tx, "EXPENSE", year, expenseFormat);
        const feeExpense = await tx.expense.create({
          data: {
            number: feeExpenseNumber,
            date,
            supplierId: null,
            payeeText: order.gatewayName,
            categoryId: feeCategory.id,
            amount: gatewayFee,
            withholdingApplied: "0",
            cashAccountId: null,
            receiptNo: null,
            notes: "Gateway fee withheld from settlement - web order " + order.number + ", payment ref " + order.gatewayPaymentRef + ".",
            salesOrderId: so.id,
            purchaseOrderId: null,
            businessId: null,
            createdById: actor.id,
          },
        });
        await writeAudit(tx, {
          userId: actor.id,
          entityType: "Expense",
          entityId: feeExpense.id,
          action: "create",
          after: {
            number: feeExpenseNumber,
            date: ymd(date),
            payee: order.gatewayName,
            category: feeCategory.label,
            amount: gatewayFee,
            withholdingApplied: "0.00",
            cashAccount: null,
            salesOrder: soNumber,
            source: "Store order " + order.number,
          },
        });
      }

      // --- Store order → CONFIRMED, with the §10.11 informational
      // figures recorded (margin + total — informational only, never a
      // block, per the settled ruling).
      await tx.storeOrder.update({
        where: { id: order.id },
        data: { status: "CONFIRMED", salesOrderId: so.id, convertedById: actor.id, convertedAt: new Date() },
      });
      await writeAudit(tx, {
        userId: actor.id,
        entityType: "StoreOrder",
        entityId: order.id,
        action: "update",
        after: {
          number: order.number,
          salesOrder: soNumber,
          billing: billingNumber,
          collection: collectionNumber,
          invoiceNo: input.invoiceNo,
          amountPaid,
          gatewayFee: money(order.gatewayFee),
          ...(feeExpenseNumber ? { feeExpense: feeExpenseNumber } : {}),
          netMarginPct: totals.netMarginPct,
          conversionPrompts: "informational-only (§10.11)",
        },
      });

      return { salesOrderId: so.id, salesOrderNumber: soNumber, billingNumber, collectionNumber };
    }, DOC_TX),
  );
}
