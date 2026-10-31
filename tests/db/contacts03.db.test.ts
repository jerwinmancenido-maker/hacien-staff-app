// Addresses, business documents and the Transactions tab against MySQL 8
// (TEST_DATABASE_URL). Uploads go to a temporary UPLOAD_DIR.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/permissions";
import { CompanyRuleError } from "@/lib/services/companies";
import { addressOwnerOf, customerBlockAddress, listAddresses, makeDefaultAddress, saveAddress, setAddressArchived } from "@/lib/services/addresses";
import {
  documentExpiryCounts,
  listBusinessDocuments,
  ownersWithExpiringDocuments,
  setBusinessDocumentArchived,
  uploadBusinessDocument,
} from "@/lib/services/business-documents";
import { businessDocumentDownload } from "@/lib/business-docs/download";
import { listTransactions, openDocumentStats, TRANSACTIONS_PAGE_SIZE } from "@/lib/services/transactions";
import { convertQuoteToSalesOrder, createQuote, voidQuote, type DocActor } from "@/lib/services/quotes";
import { getQuotePrint, getSalesOrderPrint } from "@/lib/quotes/views";
import { addDays, manilaToday } from "@/lib/format";
import type { AddressInput } from "@/lib/validation/addresses";
import type { BusinessDocumentMeta } from "@/lib/validation/business-documents";
import { freshYear, makeCustomer, makeSupplier, makeUser, quoteInput, tag } from "./fixtures";

const COST_KEYS = ["supplierCost", "netMargin", "netMarginPct", "supplierId", "supplierName", "supplierTotal", "margin"];

function keysDeep(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
  else if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysDeep(v, out);
    }
  }
  return out;
}

const addr = (extra: Partial<AddressInput> = {}): AddressInput => ({
  kind: "BILLING",
  label: null,
  street: "12 Rizal St.",
  barangay: "San Antonio",
  cityMunicipality: "Pasig City",
  province: "Metro Manila",
  zip: "1605",
  isDefault: false,
  ...extra,
});

const meta = (extra: Partial<BusinessDocumentMeta> = {}): BusinessDocumentMeta => ({
  type: "BIR_2303",
  otherLabel: null,
  docNumber: "OCN-123",
  issueDate: null,
  expiryDate: null,
  replacesId: null,
  ...extra,
});

const pdf = (body = "hello") => {
  const bytes = new TextEncoder().encode(`%PDF-1.4\n${body}\n%%EOF\n`);
  return { name: "BIR 2303.pdf", size: bytes.byteLength, bytes };
};

describe.skipIf(!env.hasDb)("addresses, business documents, transactions (MySQL)", () => {
  let admin: DocActor;
  let staff: DocActor;
  let viewer: DocActor;
  let uploadDir: string;

  beforeAll(async () => {
    uploadDir = mkdtempSync(path.join(tmpdir(), "hacien-uploads-"));
    process.env.UPLOAD_DIR = uploadDir;
    [admin, staff, viewer] = await Promise.all([makeUser("costs"), makeUser("staff"), makeUser("viewer")]);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  // -------------------------------------------------------------------------
  describe("legacy address migration", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../prisma/migrations/20261030120000_addresses_business_documents/migration.sql"), "utf8");
    const backfill = sql
      .slice(sql.indexOf("-- BEGIN legacy address backfill"), sql.indexOf("-- END legacy address backfill"))
      .split(";")
      .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
      .filter(Boolean);

    it("copies the old text into the street of a default BILLING address flagged needs review, once", async () => {
      expect(backfill).toHaveLength(2);
      const t = tag();
      const legacy = await db.customer.create({ data: { name: `Legacy ${t}`, withholdingType: "NONE", address: "  Sample Tower, Ortigas Center\nPasig City  " } });
      const blank = await db.customer.create({ data: { name: `Blank ${t}`, withholdingType: "NONE", address: "   " } });
      const supplier = await db.supplier.create({ data: { name: `Legacy supplier ${t}`, taxType: "VAT", address: "Gilmore Ave., Quezon City" } });

      for (const stmt of backfill) await db.$executeRawUnsafe(stmt);
      for (const stmt of backfill) await db.$executeRawUnsafe(stmt); // second run adds nothing

      const rows = await db.address.findMany({ where: { customerId: legacy.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: "BILLING",
        isDefault: true,
        needsReview: true,
        street: "Sample Tower, Ortigas Center\nPasig City",
        barangay: "",
        cityMunicipality: "",
        province: "",
        zip: "",
        supplierId: null,
        archivedAt: null,
      });
      expect(await db.address.count({ where: { customerId: blank.id } })).toBe(0);
      const sup = await db.address.findMany({ where: { supplierId: supplier.id } });
      expect(sup).toHaveLength(1);
      expect(sup[0]).toMatchObject({ kind: "BILLING", isDefault: true, needsReview: true, street: "Gilmore Ave., Quezon City" });
      // The old column is kept for one release.
      expect((await db.customer.findUniqueOrThrow({ where: { id: legacy.id } })).address).toContain("Sample Tower");
      // Print falls back to the copied text.
      expect(await customerBlockAddress(legacy)).toBe("Sample Tower, Ortigas Center\nPasig City");
    });
  });

  // -------------------------------------------------------------------------
  describe("addresses", () => {
    it("one default per kind, make default, archive promotes the next, all audited", async () => {
      const c = await makeCustomer();
      const owner = { kind: "customer" as const, id: c.id };
      const a = await saveAddress(null, owner, addr(), staff.id);
      const b = await saveAddress(null, owner, addr({ street: "99 Second St." }), staff.id);
      const d = await saveAddress(null, owner, addr({ kind: "DELIVERY", street: "Warehouse 3" }), staff.id);
      expect([a.isDefault, b.isDefault, d.isDefault]).toEqual([true, false, true]);

      await makeDefaultAddress(b.id, staff.id);
      let list = await listAddresses(owner);
      expect(list.filter((x) => x.kind === "BILLING" && x.isDefault).map((x) => x.id)).toEqual([b.id]);

      await setAddressArchived(b.id, true, staff.id);
      list = await listAddresses(owner);
      expect(list.map((x) => x.id)).not.toContain(b.id);
      expect(list.find((x) => x.id === a.id)?.isDefault).toBe(true);
      expect((await listAddresses(owner, { includeArchived: true })).map((x) => x.id)).toContain(b.id);

      // A new default while saving moves the flag.
      const e = await saveAddress(null, owner, addr({ kind: "DELIVERY", street: "Site office", isDefault: true }), staff.id);
      expect(e.isDefault).toBe(true);
      expect((await db.address.findUniqueOrThrow({ where: { id: d.id } })).isDefault).toBe(false);

      const audit = await db.auditLog.findMany({ where: { entityType: "Address", entityId: { in: [a.id, b.id, d.id, e.id] } } });
      const actions = audit.map((r) => r.action);
      expect(actions.filter((x) => x === "create")).toHaveLength(4);
      expect(actions).toContain("archive");
      expect(actions).toContain("update");
      expect(audit.every((r) => r.userId === staff.id)).toBe(true);
    });

    it("moving a default to another kind doesn't steal that kind's default", async () => {
      const c = await makeCustomer();
      const owner = { kind: "customer" as const, id: c.id };
      const bill = await saveAddress(null, owner, addr(), staff.id);
      const del = await saveAddress(null, owner, addr({ kind: "DELIVERY" }), staff.id);
      await saveAddress(bill.id, owner, addr({ kind: "DELIVERY" }), staff.id);
      const rows = await listAddresses(owner);
      expect(rows.filter((r) => r.isDefault).map((r) => r.id)).toEqual([del.id]);
    });

    it("editing clears needs review; editing via another owner is refused", async () => {
      const c = await makeCustomer();
      const other = await makeCustomer();
      const legacy = await db.address.create({ data: { customerId: c.id, kind: "BILLING", street: "Old text", isDefault: true, needsReview: true } });
      await expect(saveAddress(legacy.id, { kind: "customer", id: other.id }, addr(), staff.id)).rejects.toBeInstanceOf(CompanyRuleError);
      const saved = await saveAddress(legacy.id, { kind: "customer", id: c.id }, addr(), staff.id);
      expect(saved).toMatchObject({ needsReview: false, isDefault: true, barangay: "San Antonio" });
    });

    it("an address has exactly one owner", () => {
      expect(() => addressOwnerOf({ customerId: "a", supplierId: "b" })).toThrow(CompanyRuleError);
      expect(() => addressOwnerOf({ customerId: null, supplierId: null })).toThrow(CompanyRuleError);
    });

    it("a supplier keeps at least one office or billing address", async () => {
      const s = await makeSupplier();
      const owner = { kind: "supplier" as const, id: s.id };
      await expect(saveAddress(null, owner, addr({ kind: "WAREHOUSE" }), staff.id)).rejects.toThrow(/office or billing/);
      expect(await db.address.count({ where: { supplierId: s.id } })).toBe(0); // rolled back
      const office = await saveAddress(null, owner, addr({ kind: "OFFICE" }), staff.id);
      await saveAddress(null, owner, addr({ kind: "WAREHOUSE" }), staff.id);
      await expect(setAddressArchived(office.id, true, staff.id)).rejects.toThrow(/office or billing/);
      await expect(saveAddress(office.id, owner, addr({ kind: "DELIVERY" }), staff.id)).rejects.toThrow(/office or billing/);
    });

    it("print uses the default billing address; Convert snapshots the default delivery address", async () => {
      const c = await makeCustomer();
      const owner = { kind: "customer" as const, id: c.id };
      await saveAddress(null, owner, addr({ street: "18F Sample Tower" }), staff.id);
      const del = await saveAddress(null, owner, addr({ kind: "DELIVERY", street: "Warehouse 3", barangay: "Ugong", zip: "1604" }), staff.id);
      const year = await freshYear();
      const q = await createQuote(quoteInput(c.id, year), admin);
      expect((await getQuotePrint(q.id))?.customer.address).toBe("18F Sample Tower\nBrgy. San Antonio, Pasig City\nMetro Manila 1605");

      const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: null, deliveryAddress: null }, staff, { date: new Date(Date.UTC(year, 3, 1)) });
      const expected = "Warehouse 3\nBrgy. Ugong, Pasig City\nMetro Manila 1604";
      expect(so.deliveryAddress).toBe(expected);
      // Later edits don't change the SO's snapshot.
      await saveAddress(del.id, owner, addr({ kind: "DELIVERY", street: "Somewhere else" }), staff.id);
      expect((await getSalesOrderPrint(so.id))?.deliveryAddress).toBe(expected);

      // A typed address wins.
      const q2 = await createQuote(quoteInput(c.id, year), admin);
      const so2 = await convertQuoteToSalesOrder(q2.id, { buyerPoNo: null, deliveryAddress: "Gate 2, typed by hand" }, staff, { date: new Date(Date.UTC(year, 3, 2)) });
      expect(so2.deliveryAddress).toBe("Gate 2, typed by hand");
    });
  });

  // -------------------------------------------------------------------------
  describe("business documents", () => {
    it("upload → download permission matrix", async () => {
      const c = await makeCustomer();
      const owner = { kind: "customer" as const, id: c.id };
      const file = pdf("matrix");

      // Viewer can't upload; staff and admin can.
      await expect(uploadBusinessDocument(owner, meta(), file, viewer)).rejects.toBeInstanceOf(ForbiddenError);
      const doc = await uploadBusinessDocument(owner, meta(), file, staff);
      await uploadBusinessDocument(owner, meta({ type: "DTI" }), pdf("dti"), admin);

      expect(doc).toMatchObject({ mimeType: "application/pdf", sizeBytes: file.size, fileName: "BIR 2303.pdf", uploadedById: staff.id });
      expect(doc.storageKey).toMatch(/^c[0-9a-f]{32}$/);
      expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
      // On disk under the storage key only, never the user's file name.
      expect(readFileSync(path.join(uploadDir, doc.storageKey))).toEqual(Buffer.from(file.bytes));

      // Signed out → 401.
      const anon = await businessDocumentDownload(null, doc.id);
      expect(anon.status).toBe(401);

      // Viewer, staff and admin can download.
      for (const u of [viewer, staff, admin]) {
        const res = await businessDocumentDownload(u, doc.id, { ip: "203.0.113.9" });
        expect(res.status, u.id).toBe(200);
        expect(res.headers.get("content-type")).toBe("application/pdf");
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
        expect(res.headers.get("cache-control")).toBe("private, no-store");
        expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="BIR 2303.pdf"/);
        expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from(file.bytes));
      }

      // A turned-off user has no permissions.
      const off = await makeUser("staff");
      const offUser = await db.user.update({ where: { id: off.id }, data: { active: false } });
      expect((await businessDocumentDownload(offUser, doc.id)).status).toBe(403);

      // Unknown id → 404.
      expect((await businessDocumentDownload(staff, "nope")).status).toBe(404);

      // Viewer can't archive; staff can. Archived documents still download (history).
      await expect(setBusinessDocumentArchived(doc.id, true, viewer)).rejects.toBeInstanceOf(ForbiddenError);
      await setBusinessDocumentArchived(doc.id, true, staff);
      expect((await businessDocumentDownload(viewer, doc.id)).status).toBe(200);

      // Downloads are logged.
      const downloads = await db.auditLog.findMany({ where: { entityType: "BusinessDocument", entityId: doc.id, action: "download" } });
      expect(downloads.map((d) => d.userId).sort()).toEqual([viewer.id, staff.id, admin.id, viewer.id].sort());
      expect(downloads[0]?.ip).toBe("203.0.113.9");
    });

    it("path traversal is impossible: only the storage key is used", async () => {
      const c = await makeCustomer();
      const doc = await uploadBusinessDocument({ kind: "customer", id: c.id }, meta(), pdf("trav"), staff);
      for (const id of ["../../etc/passwd", "..%2F..%2Fetc%2Fpasswd", `${doc.id}/../x`]) {
        expect((await businessDocumentDownload(staff, id)).status, id).toBe(404);
      }
      // Even a tampered row can't point outside UPLOAD_DIR.
      await db.businessDocument.update({ where: { id: doc.id }, data: { storageKey: `../../../../etc/passwd#${tag()}` } });
      const res = await businessDocumentDownload(staff, doc.id);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("root:");
    });

    it("refuses fake and oversized files and stores nothing", async () => {
      const c = await makeCustomer();
      const owner = { kind: "customer" as const, id: c.id };
      const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
      await expect(uploadBusinessDocument(owner, meta(), { name: "permit.pdf", size: html.byteLength, bytes: html }, staff)).rejects.toThrow(/isn't a real PDF/);
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
      await expect(uploadBusinessDocument(owner, meta(), { name: "permit.pdf", size: png.byteLength, bytes: png }, staff)).rejects.toThrow(/is a PNG/);

      process.env.UPLOAD_MAX_MB = "1";
      try {
        const big = new Uint8Array(1024 * 1024 + 1);
        big.set(new TextEncoder().encode("%PDF-1.4\n"));
        await expect(uploadBusinessDocument(owner, meta(), { name: "big.pdf", size: big.byteLength, bytes: big }, staff)).rejects.toThrow(/too big/);
      } finally {
        delete process.env.UPLOAD_MAX_MB;
      }
      expect(await db.businessDocument.count({ where: { customerId: c.id } })).toBe(0);
    });

    it("archived documents are hidden by default; replacing archives the old one", async () => {
      const c = await makeCustomer();
      const owner = { kind: "customer" as const, id: c.id };
      const old = await uploadBusinessDocument(owner, meta({ type: "MAYORS_PERMIT" }), pdf("2025"), staff);
      const replacement = await uploadBusinessDocument(owner, meta({ type: "MAYORS_PERMIT", replacesId: old.id }), pdf("2026"), staff);
      expect(replacement.replacesId).toBe(old.id);

      const visible = await listBusinessDocuments(owner);
      expect(visible.map((d) => d.id)).toEqual([replacement.id]);
      const all = await listBusinessDocuments(owner, { includeArchived: true });
      expect(all.map((d) => d.id).sort()).toEqual([old.id, replacement.id].sort());
      expect(all.find((d) => d.id === old.id)?.archivedAt).toBeInstanceOf(Date);

      // Can't replace twice, or across owners.
      await expect(uploadBusinessDocument(owner, meta({ replacesId: old.id }), pdf("again"), staff)).rejects.toThrow(/already replaced/);
      const other = await makeCustomer();
      await expect(uploadBusinessDocument({ kind: "customer", id: other.id }, meta({ replacesId: replacement.id }), pdf("x"), staff)).rejects.toThrow(/wasn't found/);
      expect(await db.businessDocument.count({ where: { customerId: other.id } })).toBe(0);

      const audit = await db.auditLog.findMany({ where: { entityType: "BusinessDocument", entityId: old.id } });
      expect(audit.map((a) => a.action).sort()).toEqual(["archive", "create"]);
    });

    it("expiry counts and the Expiring documents filter", async () => {
      const c = await makeCustomer();
      const fine = await makeCustomer();
      const owner = { kind: "customer" as const, id: c.id };
      const today = manilaToday();
      await uploadBusinessDocument(owner, meta({ type: "MAYORS_PERMIT", expiryDate: addDays(today, -1) }), pdf("expired"), staff);
      await uploadBusinessDocument(owner, meta({ type: "BARANGAY_CLEARANCE", expiryDate: addDays(today, 10) }), pdf("soon"), staff);
      await uploadBusinessDocument(owner, meta({ type: "DTI", expiryDate: addDays(today, 400) }), pdf("later"), staff);
      await uploadBusinessDocument({ kind: "customer", id: fine.id }, meta({ expiryDate: addDays(today, 200) }), pdf("ok"), staff);
      const archived = await uploadBusinessDocument({ kind: "customer", id: fine.id }, meta({ expiryDate: addDays(today, -5) }), pdf("old"), staff);
      await setBusinessDocumentArchived(archived.id, true, staff);

      expect(await documentExpiryCounts(owner, 30, today)).toEqual({ active: 3, expired: 1, expiring: 1 });
      expect(await documentExpiryCounts(owner, 5, today)).toEqual({ active: 3, expired: 1, expiring: 0 });
      const ids = await ownersWithExpiringDocuments("customer", 30, today);
      expect(ids).toContain(c.id);
      expect(ids).not.toContain(fine.id); // its expired one is archived
    });
  });

  // -------------------------------------------------------------------------
  describe("transactions", () => {
    async function setup() {
      const c = await makeCustomer();
      const contact = c.contacts[0]!;
      const other = await db.contact.create({ data: { customerId: c.id, name: `Other ${tag()}`, email: `o-${tag()}@test.example.com` } });
      const supplier = await makeSupplier();
      const year = await freshYear();
      const q1 = await createQuote(quoteInput(c.id, year, { contactId: contact.id }, supplier.id), admin);
      const q2 = await createQuote(quoteInput(c.id, year, { contactId: other.id, date: new Date(Date.UTC(year, 4, 1)) }), admin);
      const q3 = await createQuote(quoteInput(c.id, year, { contactId: contact.id, date: new Date(Date.UTC(year, 5, 1)) }, supplier.id), admin);
      await voidQuote(q2.id, "Customer cancelled", admin);
      const so = await convertQuoteToSalesOrder(q1.id, { buyerPoNo: null, deliveryAddress: null }, admin, { date: new Date(Date.UTC(year, 6, 1)) });
      return { c, contact, other, supplier, q1, q2, q3, so };
    }

    it("lists quotes and SOs newest first with totals per type excluding VOID", async () => {
      const { c, q1, q2, q3, so } = await setup();
      const list = await listTransactions({ kind: "customer", id: c.id }, {}, admin);
      expect(list.rows.map((r) => r.id)).toEqual([so.id, q3.id, q2.id, q1.id]);
      expect(list.rows[0]).toMatchObject({ kind: "SALES_ORDER", number: so.number, status: "OPEN", total: "540000.00", href: `/sales-orders/${so.id}` });
      expect(list.rows[1]).toMatchObject({ kind: "QUOTE", href: `/quotes/${q3.id}`, contactName: c.contacts[0]!.name });
      const quotes = list.totals.find((t) => t.kind === "QUOTE")!;
      expect(quotes).toMatchObject({ count: 2, total: "1080000.00", voidCount: 1, supplierCost: "910000.00", netMargin: "170000.00" });
      expect(list.totals.find((t) => t.kind === "SALES_ORDER")).toMatchObject({ count: 1, total: "540000.00", voidCount: 0 });
    });

    it("filters by contact, type and status", async () => {
      const { c, contact, other, q1, q2, q3, so } = await setup();
      const owner = { kind: "customer" as const, id: c.id };
      expect((await listTransactions(owner, { contactId: contact.id }, staff)).rows.map((r) => r.id)).toEqual([so.id, q3.id, q1.id]);
      expect((await listTransactions(owner, { contactId: other.id }, staff)).rows.map((r) => r.id)).toEqual([q2.id]);
      expect((await listTransactions(owner, { type: "SALES_ORDER" }, staff)).rows.map((r) => r.id)).toEqual([so.id]);
      expect((await listTransactions(owner, { status: "VOID" }, staff)).rows.map((r) => r.id)).toEqual([q2.id]);
      expect((await listTransactions(owner, { status: "WON" }, staff)).rows.map((r) => r.id)).toEqual([q1.id]);
      expect((await listTransactions(owner, { status: "OPEN" }, staff)).rows.map((r) => r.id)).toEqual([so.id]);
      // Another customer's contact finds nothing here.
      const stranger = await makeCustomer();
      expect((await listTransactions(owner, { contactId: stranger.contacts[0]!.id }, staff)).rows).toEqual([]);
    });

    it("staff and viewer payloads have no cost fields; cost users get them", async () => {
      const { c, supplier } = await setup();
      for (const u of [staff, viewer]) {
        const list = await listTransactions({ kind: "customer", id: c.id }, {}, u);
        const keys = keysDeep(list);
        for (const k of COST_KEYS) expect(keys.has(k), `${u.id}: ${k}`).toBe(false);
        expect(list.canSeeCosts).toBe(false);
        expect(JSON.stringify(list)).not.toContain("910000");
        // Which quotes use a supplier is cost information.
        const sup = await listTransactions({ kind: "supplier", id: supplier.id }, {}, u);
        expect(sup).toMatchObject({ restricted: true, rows: [], totals: [] });
        expect(await openDocumentStats({ kind: "supplier", id: supplier.id }, u)).toBeNull();
      }
      const withCosts = await listTransactions({ kind: "customer", id: c.id }, {}, admin);
      expect(withCosts.rows[0]).toHaveProperty("supplierCost");
      expect(withCosts.rows[0]).toHaveProperty("netMarginPct");
    });

    it("supplier Transactions never lists quotes or SOs (only POs / RRs / bills)", async () => {
      const { supplier } = await setup();
      const list = await listTransactions({ kind: "supplier", id: supplier.id }, {}, admin);
      expect(list.rows.every((r) => ["PURCHASE_ORDER", "RECEIVING_REPORT", "SUPPLIER_BILL"].includes(r.kind))).toBe(true);
      expect(list.rows.some((r) => r.kind === "QUOTE" || r.kind === "SALES_ORDER")).toBe(false);
      expect(list.totals.some((t) => t.kind === "QUOTE" || t.kind === "SALES_ORDER")).toBe(false);
      // No POs yet in this setup → empty purchasing list for a cost user.
      expect(list.rows).toEqual([]);
      expect(list.restricted).toBe(false);
    });

    it("overview stats count open quotes and open SOs", async () => {
      const { c } = await setup();
      const stats = await openDocumentStats({ kind: "customer", id: c.id }, staff);
      // q3 is Draft (open); q1 Won; q2 Void.
      expect(stats).toMatchObject({ openQuotes: 1, openQuotesTotal: "540000.00", openSalesOrders: 1, openSalesOrdersTotal: "540000.00" });
      expect(stats?.lastDocAt).toBeInstanceOf(Date);
    });

    it("supplier overview stats omit open quotes/SOs (Open POs only)", async () => {
      const { supplier } = await setup();
      const stats = await openDocumentStats({ kind: "supplier", id: supplier.id }, admin);
      expect(stats).toMatchObject({
        openQuotes: 0,
        openQuotesTotal: "0.00",
        openSalesOrders: 0,
        openSalesOrdersTotal: "0.00",
        openPos: 0,
        awaitingReceipt: 0,
      });
    });

    it("paginates 50 per page across quotes and SOs", async () => {
      const c = await makeCustomer();
      const year = await freshYear();
      for (let i = 0; i < TRANSACTIONS_PAGE_SIZE + 3; i++) {
        await createQuote(quoteInput(c.id, year, { date: new Date(Date.UTC(year, 0, 1 + i)) }), admin);
      }
      const owner = { kind: "customer" as const, id: c.id };
      const p1 = await listTransactions(owner, { page: 1 }, staff);
      const p2 = await listTransactions(owner, { page: 2 }, staff);
      expect(p1.rows).toHaveLength(50);
      expect(p2.rows).toHaveLength(3);
      expect(p1.pages).toBe(2);
      expect(p1.totalRows).toBe(53);
      expect(new Set([...p1.rows, ...p2.rows].map((r) => r.id)).size).toBe(53);
      // Newest first.
      expect(p1.rows[0]!.date > p2.rows[2]!.date).toBe(true);
      expect(p1.totals[0]).toMatchObject({ kind: "QUOTE", count: 53 });
    }, 120_000);
  });
});
