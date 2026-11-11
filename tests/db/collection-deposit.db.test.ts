// Audit E: standalone deposit / advance collection. Runs on MySQL 8 (TEST_DATABASE_URL); skipped locally.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { getSettingsSnapshot } from "@/lib/settings";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { recordBilling } from "@/lib/services/billings";
import {
  applyCreditSimple,
  customerCreditBalance,
  customerDepositBalance,
  recordCollection,
  voidCollection,
} from "@/lib/services/collections";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeUser, quoteInput } from "./fixtures";

async function ensureWideBooklet(adminId: string) {
  const wide = { seriesFrom: 1, seriesTo: 9_999_999, label: "Test booklet deposit" };
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
          createdById: adminId,
        },
      });
      return;
    } catch {
      // Unique version race with another suite — retry.
    }
  }
}

describe.skipIf(!env.hasDb)("deposit / advance collection (MySQL)", () => {
  let admin: DocActor;
  let invoiceSeq = 0;

  async function nextInvoice(): Promise<number> {
    if (invoiceSeq === 0) {
      const [maxBilling, maxSpoiled, maxClaim] = await Promise.all([
        db.billing.aggregate({ _max: { invoiceNo: true } }),
        db.spoiledBookletNumber.aggregate({ _max: { number: true }, where: { type: "SI" } }),
        db.bookletSerialClaim.aggregate({ _max: { number: true }, where: { type: "SI" } }),
      ]);
      const maxUsed = Math.max(
        880_000,
        Number(maxBilling._max.invoiceNo ?? 0),
        Number(maxSpoiled._max.number ?? 0),
        Number(maxClaim._max.number ?? 0),
      );
      invoiceSeq = maxUsed + Math.floor(Math.random() * 500) + 1;
    }

    for (let attempt = 0; attempt < 500; attempt++) {
      const candidate = ++invoiceSeq;
      const [takenBilling, spoiled, takenClaim] = await Promise.all([
        db.billing.findFirst({ where: { invoiceNo: candidate }, select: { id: true } }),
        db.spoiledBookletNumber.findFirst({ where: { type: "SI", number: candidate }, select: { id: true } }),
        db.bookletSerialClaim.findFirst({ where: { type: "SI", number: candidate }, select: { number: true } }),
      ]);
      if (!takenBilling && !spoiled && !takenClaim) {
        return candidate;
      }
    }
    throw new Error("Could not allocate unused SI number after 500 attempts");
  }

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-deposit-uploads-"));
    admin = await makeUser("costs");
    await ensureWideBooklet(admin.id);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function makeOpenBilling(year: number) {
    const customer = await makeCustomer();
    const q = await createQuote(
      quoteInput(customer.id, year, {
        items: [
          {
            id: null,
            description: "Widget A",
            kind: "GOODS",
            qty: "1",
            unit: "pc",
            supplierId: null,
            supplierUnitCost: "0",
            unitPrice: "1000",
          },
        ],
      }),
      admin,
    );
    await approveQuote(q.id, admin);
    const deliveryAddressId = await customerDeliveryAddressId(customer.id);
    const so = await convertQuoteToSalesOrder(q.id, { buyerPoNo: "PO-1", deliveryAddressId }, admin);

    for (let attempt = 0; attempt < 5; attempt++) {
      const invoiceNo = await nextInvoice();
      try {
        const billing = await recordBilling(
          {
            salesOrderId: so.id,
            amount: "1000.00",
            invoiceNo,
            invoiceDate: new Date(),
            dueDate: new Date(),
            notes: null,
          },
          admin,
        );
        return { customer, so, billing };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/already used|spoiled/i.test(msg) && attempt < 4) {
          continue;
        }
        throw err;
      }
    }
    throw new Error("Failed to record billing: unable to allocate unused SI number after retries");
  }

  it("a deposit with open billings stays fully unapplied and the billing stays OPEN", async () => {
    const year = await freshYear();
    const { customer, billing } = await makeOpenBilling(year);
    const deposit = await recordCollection(
      {
        customerId: customer.id,
        date: new Date(),
        method: "BANK_TRANSFER",
        reference: "DEP-1",
        checkBank: null,
        checkDate: null,
        receiptNo: "OR-DEP-1",
        amountReceived: "400.00",
        notes: null,
        isDeposit: true,
        allocations: [],
      },
      admin,
    );
    expect(deposit.isDeposit).toBe(true);
    const after = await db.billing.findUniqueOrThrow({ where: { id: billing.id } });
    expect(after.status).toBe("OPEN");
    expect(await customerDepositBalance(customer.id)).toBe("400.00");
    expect(await customerCreditBalance(customer.id)).toBe("400.00");
  });

  it("a deposit can be applied later and pays the billing", async () => {
    const year = await freshYear();
    const { customer, billing } = await makeOpenBilling(year);
    await recordCollection(
      {
        customerId: customer.id,
        date: new Date(),
        method: "CASH",
        reference: null,
        checkBank: null,
        checkDate: null,
        receiptNo: "OR-DEP-2",
        amountReceived: "1000.00",
        notes: null,
        isDeposit: true,
        allocations: [],
      },
      admin,
    );
    await applyCreditSimple(customer.id, billing.id, "1000.00", admin);
    const after = await db.billing.findUniqueOrThrow({ where: { id: billing.id } });
    expect(after.status).toBe("PAID");
    expect(await customerDepositBalance(customer.id)).toBe("0.00");
  });

  it("a deposit with allocations is refused", async () => {
    const year = await freshYear();
    const { customer, billing } = await makeOpenBilling(year);
    await expect(
      recordCollection(
        {
          customerId: customer.id,
          date: new Date(),
          method: "CASH",
          reference: null,
          checkBank: null,
          checkDate: null,
          receiptNo: "OR-DEP-3",
          amountReceived: "1000.00",
          notes: null,
          isDeposit: true,
          allocations: [{ billingId: billing.id, cashApplied: "1000.00", withholdingApplied: "0.00" }],
        },
        admin,
      ),
    ).rejects.toThrow(/can't be allocated to a billing/);
  });

  it("voiding a deposit removes the deposits held", async () => {
    const year = await freshYear();
    const { customer } = await makeOpenBilling(year);
    const deposit = await recordCollection(
      {
        customerId: customer.id,
        date: new Date(),
        method: "CASH",
        reference: null,
        checkBank: null,
        checkDate: null,
        receiptNo: "OR-DEP-4",
        amountReceived: "250.00",
        notes: null,
        isDeposit: true,
        allocations: [],
      },
      admin,
    );
    expect(await customerDepositBalance(customer.id)).toBe("250.00");
    await voidCollection(deposit.id, "test void", admin);
    expect(await customerDepositBalance(customer.id)).toBe("0.00");
    expect(await customerCreditBalance(customer.id)).toBe("0.00");
  });
});
