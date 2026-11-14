// Phase 3 #8b: warranty claims (MySQL) — scenarios W1-W3 + status moves.
//
// W1 Claim from a receiving line -> supplier, PO, serial read through
//    the receiving record; claim starts OPEN and is audited.
// W2 Claim against a VOID receiving report -> refused.
// W3 Second ACTIVE claim on the same line + serial -> blocked, naming
//    the open claim; a different serial, or a claim after the first is
//    CLOSED, is allowed.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { approvePurchaseOrder, createPurchaseOrdersFromSalesOrder, markPurchaseOrderSent } from "@/lib/services/purchase-orders";
import { postReceivingReport, voidReceivingReport } from "@/lib/services/receiving";
import { changeWarrantyClaimStatus, createWarrantyClaim } from "@/lib/services/warranty-claims";
import { listWarrantyClaims } from "@/lib/purchasing/views";
import { freshYear, makeCustomer, makeSupplier, makeUser, tag } from "./fixtures";

describe.skipIf(!env.hasDb)("Phase 3 #8b warranty claims (MySQL)", () => {
  let admin: DocActor;
  let staff: DocActor;

  beforeAll(async () => {
    [admin, staff] = await Promise.all([makeUser("costs"), makeUser("staff")]);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  /** Build quote -> SO -> PO -> one posted receiving line; return its item id. */
  async function receivedLine(serialNumbers: string) {
    const year = await freshYear();
    const customer = await makeCustomer();
    const supplier = await makeSupplier();
    const q = await createQuote(
      {
        customerId: customer.id,
        contactId: customer.contacts[0]!.id,
        date: new Date(Date.UTC(year, 2, 1)),
        validUntil: undefined,
        terms: "Net 30",
        notes: null,
        items: [
          { id: null, description: `Claimable unit ${tag()}`, kind: "GOODS", qty: "2", unit: "pc", supplierId: supplier.id, supplierUnitCost: "1000", unitPrice: "1500" },
        ],
      },
      admin,
    );
    await approveQuote(q.id, admin);
    const delivAddr = await db.address.create({
      data: { customerId: customer.id, kind: "DELIVERY", street: "8b test", isDefault: true },
    });
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "W8B", deliveryAddressId: delivAddr.id }, admin, {
      date: new Date(Date.UTC(year, 2, 2)),
    });
    const [po] = await createPurchaseOrdersFromSalesOrder(
      so.id,
      { date: new Date(Date.UTC(year, 2, 3)), expectedDate: null, deliveryAddressText: null, supplierPicks: {} },
      admin,
    );
    await approvePurchaseOrder(po!.id, admin);
    await markPurchaseOrderSent(po!.id, admin);
    const lines = await db.purchaseOrderItem.findMany({ where: { purchaseOrderId: po!.id } });
    const rr = await postReceivingReport(
      po!.id,
      {
        receivedDate: new Date(Date.UTC(year, 3, 1)),
        receivedById: staff.id,
        deliveryRef: "DR-8B",
        notes: null,
        lines: [{ lineId: lines[0]!.id, qty: "2", warrantyEndDate: null, serialNumbers }],
      },
      staff,
    );
    return { po: po!, rr, itemId: rr.items[0]!.id, supplier };
  }

  it("W1: files an OPEN claim on a posted receiving line; supplier/PO/serial resolve; create is audited", async () => {
    const { po, itemId, supplier } = await receivedLine("SN-8B-1, SN-8B-2");
    const claim = await createWarrantyClaim(itemId, { serialNumber: "SN-8B-1", fault: "Fan does not spin", supplierRef: null }, staff);
    expect(claim.status).toBe("OPEN");
    expect(claim.serialNumber).toBe("SN-8B-1");

    const rows = await listWarrantyClaims({ q: po.number });
    const ours = rows.filter((r) => r.id === claim.id);
    expect(ours).toHaveLength(1);
    expect(ours[0]!.supplierName).toBe(supplier.name);
    expect(ours[0]!.purchaseOrderNumber).toBe(po.number);

    const audit = await db.auditLog.findFirst({ where: { entityType: "WarrantyClaim", entityId: claim.id, action: "create" } });
    expect(audit).not.toBeNull();
    expect((audit!.after as { supplier?: string }).supplier).toBe(supplier.name);
  });

  it("W2: refuses a claim on a VOID receiving report", async () => {
    const { rr, itemId } = await receivedLine("SN-8B-VOID");
    await voidReceivingReport(rr.id, "Wrong count", admin);
    await expect(createWarrantyClaim(itemId, { serialNumber: "SN-8B-VOID", fault: "Dead on arrival", supplierRef: null }, staff)).rejects.toThrow(
      /void/i,
    );
  });

  it("W3: blocks a second active claim on the same line + serial, naming the open one; other serial / after close allowed", async () => {
    const { itemId } = await receivedLine("SN-8B-A, SN-8B-B");
    const first = await createWarrantyClaim(itemId, { serialNumber: "SN-8B-A", fault: "No power", supplierRef: null }, staff);
    await expect(
      createWarrantyClaim(itemId, { serialNumber: "sn-8b-a", fault: "Also no power", supplierRef: null }, staff),
    ).rejects.toThrow(new RegExp(first.id));
    // A different serial on the same line is a different claim.
    const other = await createWarrantyClaim(itemId, { serialNumber: "SN-8B-B", fault: "Cracked case", supplierRef: null }, staff);
    expect(other.status).toBe("OPEN");
    // Once the first claim is CLOSED, the same serial can be claimed again.
    await changeWarrantyClaimStatus(first.id, "CLOSED", staff);
    const again = await createWarrantyClaim(itemId, { serialNumber: "SN-8B-A", fault: "Failed again", supplierRef: null }, staff);
    expect(again.status).toBe("OPEN");
  });

  it("status moves follow the approved transitions and are audited; illegal moves are refused", async () => {
    const { itemId } = await receivedLine("SN-8B-MOVE");
    const claim = await createWarrantyClaim(itemId, { serialNumber: "SN-8B-MOVE", fault: "Overheats", supplierRef: null }, staff);
    await expect(changeWarrantyClaimStatus(claim.id, "APPROVED", staff)).rejects.toThrow(/cannot move/i);
    await changeWarrantyClaimStatus(claim.id, "SENT_TO_SUPPLIER", staff);
    await changeWarrantyClaimStatus(claim.id, "APPROVED", staff);
    const done = await changeWarrantyClaimStatus(claim.id, "REPLACED", staff);
    expect(done.status).toBe("REPLACED");
    await expect(changeWarrantyClaimStatus(claim.id, "CLOSED", staff)).rejects.toThrow(/cannot move/i);
    const audits = await db.auditLog.count({ where: { entityType: "WarrantyClaim", entityId: claim.id, action: "update" } });
    expect(audits).toBe(3);
  });

  it("refuses a serial that was not received on the line", async () => {
    const { itemId } = await receivedLine("SN-8B-KNOWN");
    await expect(
      createWarrantyClaim(itemId, { serialNumber: "SN-UNKNOWN", fault: "Broken", supplierRef: null }, staff),
    ).rejects.toThrow(/not one of the serials/i);
  });
});
