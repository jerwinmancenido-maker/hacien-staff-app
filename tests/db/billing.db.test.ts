// Customer billing & collections against MySQL 8 (TEST_DATABASE_URL).

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
import { getSettingsSnapshot } from "@/lib/settings";
import { DocRuleError, money } from "@/lib/documents/common";
import { fromScaled, toScaled } from "@/lib/quotes/calc";
import { convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { recordBilling, voidBilling, soBillingSummary } from "@/lib/services/billings";
import { applyCustomerCredit, customerCreditBalance, mark2307Received, recordCollection, voidCollection } from "@/lib/services/collections";
import { listTransactions } from "@/lib/services/transactions";
import { arAgingSummary, getStatement, list2307 } from "@/lib/billing/views";
import { freshYear, makeCustomer, makeSupplier, makeUser, tag } from "./fixtures";

describe.skipIf(!env.hasDb)("billing & collections (MySQL)", () => {
  let admin: DocActor;
  let approver: DocActor;
  let staff: DocActor;
  let viewer: DocActor;

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-billing-uploads-"));
    [admin, staff, viewer] = await Promise.all([makeUser("costs"), makeUser("staff"), makeUser("viewer")]);
    const t = tag();
    approver = await db.user.create({
      data: { email: `approver-bill-${t}@test.example.com`, name: `Approver ${t}`, isApprover: true, canSeeCosts: true },
    });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  /** Parallel suites can republish settings with the default 1–500 booklet. */
  async function ensureWideBooklet() {
    const wide = { seriesFrom: 1, seriesTo: 9_999_999, label: "Test booklet billing" };
    for (let attempt = 0; attempt < 5; attempt++) {
      const snap = await getSettingsSnapshot();
      if (snap.settings.invoiceBooklet.seriesTo >= 9_999_999) return;
      const latest = await db.settingsVersion.findFirstOrThrow({ orderBy: { version: "desc" } });
      try {
        await db.settingsVersion.create({
          data: {
            version: latest.version + 1,
            data: { ...(latest.data as object), invoiceBooklet: wide } as never,
            changedKey: "invoiceBooklet",
            before: snap.settings.invoiceBooklet,
            after: wide,
            createdById: admin.id,
          },
        });
        return;
      } catch {
        // Unique version race with another suite — retry.
      }
    }
  }

  async function openSo(year: number, contractExtra?: { unitPrice?: string }) {
    await ensureWideBooklet();
    const customer = await makeCustomer(["GOODS_1"]);
    const supplier = await makeSupplier();
    // Ensure GOODS_1 rate exists for snapshot.
    const rate = await db.withholdingRate.findUnique({ where: { code: "GOODS_1" } });
    if (!rate) {
      await db.withholdingRate.create({
        data: { code: "GOODS_1", label: "Goods 1%", lineKind: "GOODS", atcCode: "WC010", rate: "0.0100", sortOrder: 1 },
      });
    }
    const q = await createQuote(
      {
        customerId: customer.id,
        contactId: customer.contacts[0]!.id,
        date: new Date(Date.UTC(year, 2, 1)),
        validUntil: undefined,
        terms: "Net 30",
        notes: null,
        items: [
          {
            id: null,
            description: "Goods",
            kind: "GOODS",
            qty: "1",
            unit: "lot",
            supplierId: supplier.id,
            supplierUnitCost: "80000",
            unitPrice: contractExtra?.unitPrice ?? "100000",
          },
        ],
      },
      admin,
    );
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "B-AR", deliveryAddress: "Manila" }, admin, {
      date: new Date(Date.UTC(year, 2, 2)),
    });
    return { customer, so, year };
  }

  /** Unique booklet numbers per test (settings allow up to 9_999_999 in this suite). */
  let invoiceSeq = 700_000 + Math.floor(Math.random() * 50_000);
  const nextInvoice = () => ++invoiceSeq;

  it("Admin and Approver can record; Staff and Viewer cannot", async () => {
    const year = await freshYear();
    const { so } = await openSo(year);
    const base = {
      salesOrderId: so.id,
      amount: "10000.00",
      invoiceDate: new Date(Date.UTC(year, 2, 5)),
      dueDate: new Date(Date.UTC(year, 3, 4)),
      notes: null as string | null,
    };
    await expect(recordBilling({ ...base, invoiceNo: nextInvoice() }, staff)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordBilling({ ...base, invoiceNo: nextInvoice() }, viewer)).rejects.toBeInstanceOf(ForbiddenError);
    const a = await recordBilling({ ...base, invoiceNo: nextInvoice() }, admin);
    expect(a.number).toMatch(/^BL-\d{4}-\d+$/);
    const b = await recordBilling({ ...base, amount: "5000.00", invoiceNo: nextInvoice() }, approver);
    expect(b.createdById).toBe(approver.id);
  });

  it("cannot bill more than SO remaining; concurrent billings respect the cap", async () => {
    const year = await freshYear();
    const { so } = await openSo(year, { unitPrice: "1000.00" });
    const soRow = await db.salesOrder.findUniqueOrThrow({ where: { id: so.id } });
    expect(money(soRow.contractPrice)).toBe("1000.00");

    const mk = (invoiceNo: number, amount: string) =>
      recordBilling(
        {
          salesOrderId: so.id,
          amount,
          invoiceNo,
          invoiceDate: new Date(Date.UTC(year, 2, 5)),
          dueDate: new Date(Date.UTC(year, 3, 4)),
          notes: null,
        },
        admin,
      );

    const n1 = nextInvoice();
    const n2 = nextInvoice();
    const n3 = nextInvoice();
    const results = await Promise.allSettled([mk(n1, "600.00"), mk(n2, "600.00"), mk(n3, "600.00")]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected");
    expect(ok.length).toBe(1);
    expect(bad.length).toBe(2);
    for (const r of bad) {
      expect(r.status).toBe("rejected");
      if (r.status === "rejected") expect(r.reason).toBeInstanceOf(DocRuleError);
    }
    const summary = await soBillingSummary(so.id);
    expect(summary?.billed).toBe("600.00");
    expect(summary?.remainingToBill).toBe("400.00");
  });

  it("two billings cannot take the same booklet number at once; voided numbers stay used", async () => {
    const year = await freshYear();
    const { so } = await openSo(year);
    const inv = nextInvoice();
    const input = {
      salesOrderId: so.id,
      amount: "100.00",
      invoiceNo: inv,
      invoiceDate: new Date(Date.UTC(year, 2, 5)),
      dueDate: new Date(Date.UTC(year, 3, 4)),
      notes: null as string | null,
    };
    const [a, b] = await Promise.allSettled([recordBilling(input, admin), recordBilling(input, approver)]);
    const ok = [a, b].filter((r) => r.status === "fulfilled");
    const bad = [a, b].filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);

    const billingId = (ok[0] as PromiseFulfilledResult<{ id: string }>).value.id;
    await voidBilling(billingId, "Wrong booklet", admin);
    await expect(recordBilling(input, admin)).rejects.toThrow(/never reused|already on billing/i);
  });

  it("voided SO blocks new billings", async () => {
    const year = await freshYear();
    const { so } = await openSo(year);
    await db.salesOrder.update({
      where: { id: so.id },
      data: { status: "VOID", voidedAt: new Date(), voidReason: "Cancelled" },
    });
    await expect(
      recordBilling(
        {
          salesOrderId: so.id,
          amount: "10.00",
          invoiceNo: nextInvoice(),
          invoiceDate: new Date(Date.UTC(year, 2, 5)),
          dueDate: new Date(Date.UTC(year, 3, 4)),
          notes: null,
        },
        admin,
      ),
    ).rejects.toThrow(/open sales orders/i);
  });

  it("collections allocate, create 2307, support unapplied credit, and void reverses", async () => {
    const year = await freshYear();
    const { customer, so } = await openSo(year, { unitPrice: "10000.00" });
    const billing = await recordBilling(
      {
        salesOrderId: so.id,
        amount: "5000.00",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 2, 5)),
        dueDate: new Date(Date.UTC(year, 3, 4)),
        notes: null,
      },
      admin,
    );

    // Advance / downpayment with no allocation → full credit
    const advance = await recordCollection(
      {
        customerId: customer.id,
        date: new Date(Date.UTC(year, 2, 3)),
        method: "CASH",
        reference: null,
        checkBank: null,
        checkDate: null,
        receiptNo: "OR-ADV-1",
        amountReceived: "2000.00",
        notes: null,
        allocations: [],
      },
      admin,
    );
    expect(await customerCreditBalance(customer.id)).toBe("2000.00");

    // Collection with cash + withholding
    const col = await recordCollection(
      {
        customerId: customer.id,
        date: new Date(Date.UTC(year, 2, 6)),
        method: "BANK_TRANSFER",
        reference: "REF-1",
        checkBank: null,
        checkDate: null,
        receiptNo: "OR-2",
        amountReceived: "3000.00",
        notes: null,
        allocations: [
          {
            billingId: billing.id,
            cashApplied: "2500.00",
            withholdingApplied: "50.00",
            withholdingRate: "0.0100",
            atcCode: "WC010",
          },
        ],
      },
      admin,
    );
    expect((await db.billing.findUniqueOrThrow({ where: { id: billing.id } })).status).toBe("PARTIALLY_PAID");
    const wh = await db.withholding2307.findFirst({ where: { collectionId: col.id } });
    expect(wh?.status).toBe("PENDING");
    expect(money(wh!.amount)).toBe("50.00");

    // Apply credit partially
    await applyCustomerCredit(
      {
        customerId: customer.id,
        allocations: [{ collectionId: advance.id, billingId: billing.id, cashApplied: "1500.00", withholdingApplied: "0.00" }],
      },
      admin,
    );
    // Advance left 500; collection also left 500 unapplied → credit 1000.
    expect(await customerCreditBalance(customer.id)).toBe("1000.00");
    await expect(
      applyCustomerCredit(
        {
          customerId: customer.id,
          allocations: [{ collectionId: advance.id, billingId: billing.id, cashApplied: "600.00", withholdingApplied: "0" }],
        },
        admin,
      ),
    ).rejects.toThrow(/unapplied credit/i);

    // Staff cannot void
    await expect(voidCollection(col.id, "oops", staff)).rejects.toBeInstanceOf(ForbiddenError);

    // Mark 2307 received
    await mark2307Received(wh!.id, { receivedAt: new Date(Date.UTC(year, 2, 20)), notes: null }, admin, []);
    expect((await db.withholding2307.findUniqueOrThrow({ where: { id: wh!.id } })).status).toBe("RECEIVED");
    await expect(voidCollection(col.id, "too late", admin)).rejects.toThrow(/received 2307/i);

    // Void the advance; the other collection still has ₱500 unapplied credit.
    await voidCollection(advance.id, "Reverse advance", admin);
    expect(await customerCreditBalance(customer.id)).toBe("500.00");

    const tx = await listTransactions({ kind: "customer", id: customer.id }, { type: "BILLING" }, admin);
    expect(tx.rows.some((r) => r.kind === "BILLING")).toBe(true);
  });

  it("credit apply rejects withholding-only (no phantom 2307 / AR shrink)", async () => {
    const year = await freshYear();
    const { customer, so } = await openSo(year, { unitPrice: "5000.00" });
    const billing = await recordBilling(
      {
        salesOrderId: so.id,
        amount: "2000.00",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 2, 5)),
        dueDate: new Date(Date.UTC(year, 3, 4)),
        notes: null,
      },
      admin,
    );
    const advance = await recordCollection(
      {
        customerId: customer.id,
        date: new Date(Date.UTC(year, 2, 3)),
        method: "CASH",
        reference: null,
        checkBank: null,
        checkDate: null,
        receiptNo: "OR-CREDIT-WH-1",
        amountReceived: "1000.00",
        notes: null,
        allocations: [],
      },
      admin,
    );
    expect(await customerCreditBalance(customer.id)).toBe("1000.00");

    await expect(
      applyCustomerCredit(
        {
          customerId: customer.id,
          allocations: [
            {
              collectionId: advance.id,
              billingId: billing.id,
              cashApplied: "0.00",
              withholdingApplied: "50.00",
              withholdingRate: "0.0100",
              atcCode: "WC010",
            },
          ],
        },
        admin,
      ),
    ).rejects.toThrow(/Withholding can't be applied from customer credit/i);

    expect(await customerCreditBalance(customer.id)).toBe("1000.00");
    const bal = await db.billing.findUniqueOrThrow({ where: { id: billing.id } });
    expect(bal.status).toBe("OPEN");
    const wh = await db.withholding2307.findFirst({ where: { billingId: billing.id } });
    expect(wh).toBeNull();
    const allocs = await db.collectionAllocation.findMany({ where: { billingId: billing.id } });
    expect(allocs).toHaveLength(0);
  });

  it("concurrent collection allocations on one billing respect the remaining balance", async () => {
    const year = await freshYear();
    const { customer, so } = await openSo(year, { unitPrice: "1000.00" });
    const billing = await recordBilling(
      {
        salesOrderId: so.id,
        amount: "1000.00",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 2, 5)),
        dueDate: new Date(Date.UTC(year, 3, 4)),
        notes: null,
      },
      admin,
    );

    const mk = (receiptNo: string) =>
      recordCollection(
        {
          customerId: customer.id,
          date: new Date(Date.UTC(year, 2, 6)),
          method: "CASH",
          reference: null,
          checkBank: null,
          checkDate: null,
          receiptNo,
          amountReceived: "600.00",
          notes: null,
          allocations: [
            {
              billingId: billing.id,
              cashApplied: "600.00",
              withholdingApplied: "0.00",
            },
          ],
        },
        admin,
      );

    const results = await Promise.allSettled([mk("OR-CONC-A"), mk("OR-CONC-B"), mk("OR-CONC-C")]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected");
    expect(ok.length).toBe(1);
    expect(bad.length).toBe(2);
    for (const r of bad) {
      expect(r.status).toBe("rejected");
      if (r.status === "rejected") expect(r.reason).toBeInstanceOf(DocRuleError);
    }

    const allocs = await db.collectionAllocation.findMany({
      where: { billingId: billing.id, collection: { status: "POSTED" } },
    });
    const applied = allocs.reduce((a, x) => a + toScaled(money(x.cashApplied), 2), 0n);
    expect(applied).toBe(toScaled("600.00", 2));
    const row = await db.billing.findUniqueOrThrow({ where: { id: billing.id } });
    expect(row.status).toBe("PARTIALLY_PAID");
  });

  it("concurrent credit applies on one collection never exceed available credit", async () => {
    const year = await freshYear();
    const { customer, so } = await openSo(year, { unitPrice: "2000.00" });
    const b1 = await recordBilling(
      {
        salesOrderId: so.id,
        amount: "1000.00",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 2, 5)),
        dueDate: new Date(Date.UTC(year, 3, 4)),
        notes: null,
      },
      admin,
    );
    const b2 = await recordBilling(
      {
        salesOrderId: so.id,
        amount: "1000.00",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 2, 5)),
        dueDate: new Date(Date.UTC(year, 3, 4)),
        notes: null,
      },
      admin,
    );
    // Fully unapplied advance — ₱500 credit available.
    const advance = await recordCollection(
      {
        customerId: customer.id,
        date: new Date(Date.UTC(year, 2, 6)),
        method: "BANK_TRANSFER",
        reference: "ADV-CONC-CREDIT",
        checkBank: null,
        checkDate: null,
        receiptNo: "OR-ADV-CONC",
        amountReceived: "500.00",
        notes: null,
        allocations: [],
      },
      admin,
    );
    expect(await customerCreditBalance(customer.id)).toBe("500.00");

    const mk = (billingId: string) =>
      applyCustomerCredit(
        {
          customerId: customer.id,
          allocations: [
            {
              collectionId: advance.id,
              billingId,
              cashApplied: "500.00",
              withholdingApplied: "0.00",
            },
          ],
        },
        admin,
      );

    const results = await Promise.allSettled([mk(b1.id), mk(b2.id)]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected");
    expect(ok.length).toBe(1);
    expect(bad.length).toBe(1);
    for (const r of bad) {
      expect(r.status).toBe("rejected");
      if (r.status === "rejected") {
        expect(r.reason).toBeInstanceOf(DocRuleError);
        expect(String(r.reason.message)).toMatch(/unapplied credit/i);
      }
    }

    const allocs = await db.collectionAllocation.findMany({
      where: { collectionId: advance.id },
    });
    const applied = allocs.reduce((a, x) => a + toScaled(money(x.cashApplied), 2), 0n);
    expect(applied).toBe(toScaled("500.00", 2));
    expect(await customerCreditBalance(customer.id)).toBe("0.00");
  });

  it("getStatement opening credit and AR as of from respect appliedOn", async () => {
    const year = await freshYear();
    const from = new Date(Date.UTC(year, 2, 1)); // Mar 1
    const before = new Date(Date.UTC(year, 1, 10)); // Feb 10
    const after = new Date(Date.UTC(year, 2, 15)); // Mar 15 (in period)

    // --- (a) credit apply dated AFTER from must not reduce opening credit or AR ---
    {
      const { customer, so } = await openSo(year, { unitPrice: "5000.00" });
      const priorBilling = await recordBilling(
        {
          salesOrderId: so.id,
          amount: "1000.00",
          invoiceNo: nextInvoice(),
          invoiceDate: before,
          dueDate: new Date(Date.UTC(year, 2, 10)),
          notes: null,
        },
        admin,
      );
      const advance = await recordCollection(
        {
          customerId: customer.id,
          date: before,
          method: "CASH",
          reference: null,
          checkBank: null,
          checkDate: null,
          receiptNo: `OR-SOA-A-${tag()}`,
          amountReceived: "500.00",
          notes: null,
          allocations: [],
        },
        admin,
      );
      const periodBilling = await recordBilling(
        {
          salesOrderId: so.id,
          amount: "2000.00",
          invoiceNo: nextInvoice(),
          invoiceDate: after,
          dueDate: new Date(Date.UTC(year, 3, 14)),
          notes: null,
        },
        admin,
      );
      await applyCustomerCredit(
        {
          customerId: customer.id,
          allocations: [
            {
              collectionId: advance.id,
              billingId: periodBilling.id,
              cashApplied: "200.00",
              withholdingApplied: "0.00",
            },
          ],
        },
        admin,
      );
      // applyCustomerCredit stamps billingToday(); pin appliedOn after `from`.
      await db.collectionAllocation.updateMany({
        where: { collectionId: advance.id, billingId: periodBilling.id },
        data: { appliedOn: after },
      });

      const doc = await getStatement(customer.id, from, null);
      expect(doc).not.toBeNull();
      // Opening AR 1000 (prior billing untouched) − opening credit 500 (late apply ignored) = 500.
      // Today's credit is 300; a today-based opening would wrongly be 1000 − 300 = 700.
      expect(await customerCreditBalance(customer.id)).toBe("300.00");
      const priorAllocs = await db.collectionAllocation.findMany({
        where: { billingId: priorBilling.id, collection: { status: "POSTED" }, appliedOn: { lt: from } },
      });
      expect(priorAllocs).toHaveLength(0);
      const openingAr = "1000.00";
      const openingCredit = "500.00";
      expect(doc!.openingBalance).toBe(fromScaled(toScaled(openingAr, 2) - toScaled(openingCredit, 2), 2));
      expect(doc!.openingBalance).toBe("500.00");
      expect(doc!.openingBalance).not.toBe("700.00");
    }

    // --- (b) credit apply dated BEFORE from must be reflected in opening credit and AR ---
    {
      const { customer, so } = await openSo(year, { unitPrice: "5000.00" });
      const priorBilling = await recordBilling(
        {
          salesOrderId: so.id,
          amount: "1000.00",
          invoiceNo: nextInvoice(),
          invoiceDate: before,
          dueDate: new Date(Date.UTC(year, 2, 10)),
          notes: null,
        },
        admin,
      );
      const advance = await recordCollection(
        {
          customerId: customer.id,
          date: before,
          method: "CASH",
          reference: null,
          checkBank: null,
          checkDate: null,
          receiptNo: `OR-SOA-B-${tag()}`,
          amountReceived: "500.00",
          notes: null,
          allocations: [],
        },
        admin,
      );
      await applyCustomerCredit(
        {
          customerId: customer.id,
          allocations: [
            {
              collectionId: advance.id,
              billingId: priorBilling.id,
              cashApplied: "200.00",
              withholdingApplied: "0.00",
            },
          ],
        },
        admin,
      );
      const applyOn = new Date(Date.UTC(year, 1, 15)); // Feb 15, before `from`
      await db.collectionAllocation.updateMany({
        where: { collectionId: advance.id, billingId: priorBilling.id },
        data: { appliedOn: applyOn },
      });

      const doc = await getStatement(customer.id, from, null);
      expect(doc).not.toBeNull();
      // Opening AR 800 and opening credit 300 both reflected → net opening 500.
      // Spot-check today's balances match as-of (all activity before `from`).
      expect(await customerCreditBalance(customer.id)).toBe("300.00");
      const bal = await db.billing.findUniqueOrThrow({ where: { id: priorBilling.id } });
      const allocs = await db.collectionAllocation.findMany({
        where: { billingId: priorBilling.id, collection: { status: "POSTED" } },
      });
      const applied = allocs.reduce((a, x) => a + toScaled(money(x.cashApplied), 2), 0n);
      const openingAr = fromScaled(toScaled(money(bal.amount), 2) - applied, 2);
      expect(openingAr).toBe("800.00");
      const openingCredit = await customerCreditBalance(customer.id);
      expect(openingCredit).toBe("300.00");
      expect(doc!.openingBalance).toBe(fromScaled(toScaled(openingAr, 2) - toScaled(openingCredit, 2), 2));
      expect(doc!.openingBalance).toBe("500.00");
    }
  });

  it("voiding a collection clears pending 2307 from list and totals", async () => {
    const year = await freshYear();
    const { customer, so } = await openSo(year, { unitPrice: "10000.00" });
    const billing = await recordBilling(
      {
        salesOrderId: so.id,
        amount: "5000.00",
        invoiceNo: nextInvoice(),
        invoiceDate: new Date(Date.UTC(year, 2, 5)),
        dueDate: new Date(Date.UTC(year, 3, 4)),
        notes: null,
      },
      admin,
    );
    const col = await recordCollection(
      {
        customerId: customer.id,
        date: new Date(Date.UTC(year, 2, 6)),
        method: "BANK_TRANSFER",
        reference: "REF-VOID-2307",
        checkBank: null,
        checkDate: null,
        receiptNo: "OR-VOID-2307",
        amountReceived: "3000.00",
        notes: null,
        allocations: [
          {
            billingId: billing.id,
            cashApplied: "2500.00",
            withholdingApplied: "50.00",
            withholdingRate: "0.0100",
            atcCode: "WC010",
          },
        ],
      },
      admin,
    );
    const wh = await db.withholding2307.findFirstOrThrow({ where: { collectionId: col.id } });
    expect(wh.status).toBe("PENDING");
    expect(money(wh.amount)).toBe("50.00");

    const beforeList = await list2307({ status: "PENDING", customerId: customer.id });
    expect(beforeList.some((r) => r.id === wh.id)).toBe(true);
    const beforeSummary = await arAgingSummary();
    expect(toScaled(beforeSummary.pending2307, 2)).toBeGreaterThanOrEqual(toScaled("50.00", 2));

    await voidCollection(col.id, "Mistake — reverse withholding", admin);

    const cleared = await db.withholding2307.findUniqueOrThrow({ where: { id: wh.id } });
    expect(cleared.status).toBe("PENDING");
    expect(money(cleared.amount)).toBe("0.00");
    expect(cleared.notes).toMatch(/Voided with collection/);

    const afterList = await list2307({ status: "PENDING", customerId: customer.id });
    expect(afterList.some((r) => r.id === wh.id)).toBe(false);
    const afterSummary = await arAgingSummary();
    // This customer's ₱50 must no longer inflate the pending total.
    expect(toScaled(afterSummary.pending2307, 2)).toBe(toScaled(beforeSummary.pending2307, 2) - toScaled("50.00", 2));
  });

  it("adds billing settings version once (idempotent migration block)", async () => {
    const sql = readFileSync(path.join(__dirname, "../../prisma/migrations/20261030160000_billing_collections/migration.sql"), "utf8");
    const block = sql.slice(sql.indexOf("-- BEGIN billing settings"), sql.indexOf("-- END billing settings"));
    // Strip keys so the insert condition matches.
    const latest = await db.settingsVersion.findFirstOrThrow({ orderBy: { version: "desc" } });
    const data = JSON.parse(JSON.stringify(latest.data)) as {
      numbering: Record<string, unknown>;
      invoiceBooklet?: unknown;
      collections?: unknown;
    };
    delete data.numbering.billing;
    delete data.numbering.collection;
    delete data.invoiceBooklet;
    delete data.collections;
    await db.settingsVersion.create({ data: { version: latest.version + 1, data: data as never, changedKey: "test" } });

    await db.$executeRawUnsafe(block);
    await db.$executeRawUnsafe(block);
    const after = await db.settingsVersion.findMany({ where: { version: { gt: latest.version } }, orderBy: { version: "asc" } });
    // test version + one migration insert
    expect(after.length).toBe(2);
    const mig = after[1]!.data as {
      numbering: { billing: unknown; collection: unknown };
      invoiceBooklet: unknown;
      collections: unknown;
    };
    expect(mig.numbering.billing).toEqual({ prefix: "BL", padding: 4, resetYearly: true });
    expect(mig.numbering.collection).toEqual({ prefix: "CR", padding: 4, resetYearly: true });
    expect(mig.invoiceBooklet).toEqual({ seriesFrom: 1, seriesTo: 500, label: "Booklet 1" });
    expect(mig.collections).toEqual({ overdueGraceDays: 0 });
    const settings = (await getSettingsSnapshot()).settings;
    expect(settings.numbering.billing.prefix).toBe("BL");
    expect(settings.invoiceBooklet.seriesTo).toBe(500);
  });
});
