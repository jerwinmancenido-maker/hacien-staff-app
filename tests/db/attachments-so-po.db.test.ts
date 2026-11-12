// REQ-ATTACH-001 (finish-all Phase 1): attachments on sales orders and
// purchase orders, against MySQL 8 (TEST_DATABASE_URL). Uploads go to a
// temporary UPLOAD_DIR. Imports the real services.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/permissions";
import { attachmentKindLabel } from "@/lib/attachment-kinds";
import { archiveAttachment, createAttachments, prepareUploads, type AttachmentOwner } from "@/lib/services/attachments";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { voidSalesOrder } from "@/lib/services/sales-orders";
import { createStandalonePurchaseOrder } from "@/lib/services/purchase-orders";
import { deleteSalesOrder } from "@/lib/services/document-delete";
import type { PoInput } from "@/lib/validation/purchasing";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeSupplier, makeUser, paymentProof, quoteInput, tag } from "./fixtures";

const REASON = "Entered in error";

describe.skipIf(!env.hasDb)("attachments on sales orders and purchase orders (MySQL)", () => {
  let admin: DocActor;
  let staff: DocActor;
  let uploadDir = "";

  beforeAll(async () => {
    uploadDir = mkdtempSync(path.join(tmpdir(), "hacien-attach-"));
    process.env.UPLOAD_DIR = uploadDir;
    [admin, staff] = await Promise.all([makeUser("costs"), makeUser("staff")]);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function attach(owner: AttachmentOwner, kind: string, actor: DocActor = admin) {
    const uploads = await prepareUploads(paymentProof);
    await db.$transaction(async (tx) => {
      await createAttachments(tx, uploads.map((u) => ({ ...u, kind })), owner, actor.id);
    });
    const rows = await db.documentAttachment.findMany({
      where: { storageKey: uploads[0]!.storageKey },
    });
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  async function openSo(year: number) {
    const customer = await makeCustomer();
    const quote = await createQuote(quoteInput(customer.id, year), admin);
    await approveQuote(quote.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    return convertQuoteToSalesOrder(quote.id, { buyerPoNo: `B-${tag()}`, deliveryAddressId }, admin, {
      date: new Date(Date.UTC(year, 2, 2)),
    });
  }

  function standalonePo(supplierId: string, year: number): PoInput {
    return {
      supplierId,
      supplierContactId: null,
      date: new Date(Date.UTC(year, 5, 1)),
      expectedDate: null,
      terms: null,
      deliveryAddressText: null,
      supplierAddressText: null,
      notes: null,
      items: [{ id: null, description: "Toner", kind: "GOODS", qty: "3", unit: "pc", unitCost: "2500" }],
    };
  }

  it("attaches a customer PO file to a sales order, kind stored", async () => {
    const year = await freshYear();
    const so = await openSo(year);
    const row = await attach({ salesOrderId: so.id }, "CUSTOMER_PO");
    expect(row.salesOrderId).toBe(so.id);
    expect(row.purchaseOrderId).toBeNull();
    expect(row.kind).toBe("CUSTOMER_PO");
    expect(attachmentKindLabel(row.kind)).toBe("Customer PO");
    expect(row.fileName).toBe("proof.png");
    expect(row.uploadedById).toBe(admin.id);
    expect(row.archivedAt).toBeNull();
    const audit = await db.auditLog.findFirst({ where: { entityType: "DocumentAttachment", entityId: row.id, action: "create" } });
    expect(audit).not.toBeNull();
  });

  it("attaches a supplier quote file to a purchase order, kind stored", async () => {
    const year = await freshYear();
    const supplier = await makeSupplier();
    const po = await createStandalonePurchaseOrder(standalonePo(supplier.id, year), admin);
    const row = await attach({ purchaseOrderId: po.id }, "SUPPLIER_QUOTE");
    expect(row.purchaseOrderId).toBe(po.id);
    expect(row.salesOrderId).toBeNull();
    expect(row.kind).toBe("SUPPLIER_QUOTE");
    expect(attachmentKindLabel(row.kind)).toBe("Supplier quote");
  });

  it("archiving hides the file from the live list, keeps row + file, and writes an audit row", async () => {
    const year = await freshYear();
    const so = await openSo(year);
    const row = await attach({ salesOrderId: so.id }, "OTHER");
    const liveBefore = await db.documentAttachment.findMany({ where: { salesOrderId: so.id, archivedAt: null } });
    expect(liveBefore.map((r) => r.id)).toContain(row.id);

    const updated = await archiveAttachment(row.id, admin);
    expect(updated.archivedAt).not.toBeNull();

    const liveAfter = await db.documentAttachment.findMany({ where: { salesOrderId: so.id, archivedAt: null } });
    expect(liveAfter.map((r) => r.id)).not.toContain(row.id);
    const kept = await db.documentAttachment.findUnique({ where: { id: row.id } });
    expect(kept).not.toBeNull();
    expect(existsSync(path.join(uploadDir, kept!.storageKey))).toBe(true);
    const audit = await db.auditLog.findFirst({ where: { entityType: "DocumentAttachment", entityId: row.id, action: "archive" } });
    expect(audit).not.toBeNull();
    expect(audit!.userId).toBe(admin.id);
  });

  it("archiving refuses a non-admin and refuses a second archive", async () => {
    const year = await freshYear();
    const so = await openSo(year);
    const row = await attach({ salesOrderId: so.id }, "CUSTOMER_PO");
    await expect(archiveAttachment(row.id, staff)).rejects.toBeInstanceOf(ForbiddenError);
    const still = await db.documentAttachment.findUnique({ where: { id: row.id } });
    expect(still!.archivedAt).toBeNull();
    await archiveAttachment(row.id, admin);
    await expect(archiveAttachment(row.id, admin)).rejects.toThrow(/already removed/i);
  });

  it("A3: a void sales order with a live attachment can't be deleted; after archiving, it can", async () => {
    const year = await freshYear();
    const so = await openSo(year);
    const row = await attach({ salesOrderId: so.id }, "CUSTOMER_PO");
    await voidSalesOrder(so.id, REASON, admin);
    await expect(deleteSalesOrder(so.id, REASON, admin)).rejects.toThrow(/attachment/i);
    await archiveAttachment(row.id, admin);
    const removed = await deleteSalesOrder(so.id, REASON, admin);
    expect(removed.id).toBe(so.id);
    expect(await db.salesOrder.findUnique({ where: { id: so.id } })).toBeNull();
    // The archived attachment row itself is kept (retention); the SO link
    // nulls via the FK's ON DELETE SET NULL (plan amendment (a)).
    const kept = await db.documentAttachment.findUnique({ where: { id: row.id } });
    expect(kept).not.toBeNull();
    expect(kept!.archivedAt).not.toBeNull();
    expect(kept!.salesOrderId).toBeNull();
  });
});
