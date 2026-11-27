// Collection deductions (ERP payment-entry model, 2026-11-28). Runs on
// MySQL 8 (TEST_DATABASE_URL); skipped locally. Proves, against the real
// services: a SERVICES and a GOODS billing each settle exactly by typed
// 2307 + deduction rows; staff can record catalogue ATC lines from the
// certificate even when the SO carries no codes; OTHER rows split by
// cash effect; over-deductions and unlabelled rows record nothing; a
// void reverses every row; new billings carry no forecast; a stored
// (pre-retirement) billing keeps its stored prefill and collects by
// typed 2307 exactly as before; the customer-default hint lends bare
// codes only; and the cost-margin net-received derives from actual
// withheld for new-model SOs while stored snapshots stay untouched.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  process.env.CASH_ENABLED = "true";
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { money } from "@/lib/documents/common";
import { getSettingsSnapshot } from "@/lib/settings";
import { approveQuote, convertQuoteToSalesOrder, createQuote, type DocActor } from "@/lib/services/quotes";
import { recordBilling } from "@/lib/services/billings";
import { recordCollection, voidCollection, withholdingCodePrefill } from "@/lib/services/collections";
import { cashAccountBalance, createCashAccount } from "@/lib/services/cash-accounts";
import { getSoCostMargin } from "@/lib/purchasing/views";
import { customerDeliveryAddressId, freshYear, makeCustomer, makeUser, quoteInput, tag } from "./fixtures";

async function ensureWideBooklet(adminId: string) {
  const wide = { seriesFrom: 1, seriesTo: 9_999_999, label: "Test booklet collection deductions" };
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

describe.skipIf(!env.hasDb)("collection deductions (MySQL)", () => {
  let admin: DocActor;
  let staff: DocActor;
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
      if (!takenBilling && !spoiled && !takenClaim) return candidate;
    }
    throw new Error("Could not allocate unused SI number after 500 attempts");
  }

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "hacien-collded-uploads-"));
    admin = await makeUser("costs");
    staff = await makeUser("staff");
    await ensureWideBooklet(admin.id);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function makeAccount() {
    return createCashAccount(
      {
        name: `Deduction account-${tag()}`,
        type: "BANK",
        bankName: "Test Bank",
        accountHintLast4: "1234",
        openingBalance: "0.00",
        openingDate: new Date(Date.UTC(2026, 0, 1)),
        active: true,
      },
      admin,
    );
  }

  async function makeOpenBilling(year: number, kind: "GOODS" | "SERVICES") {
    const customer = await makeCustomer();
    const q = await createQuote(
      quoteInput(customer.id, year, {
        items: [
          {
            id: null,
            description: kind === "SERVICES" ? "Consulting" : "Widget A",
            kind,
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
        if (/already used|spoiled/i.test(msg) && attempt < 4) continue;
        throw err;
      }
    }
    throw new Error("Failed to record billing: unable to allocate unused SI number after retries");
  }

  function collectionInput(
    customerId: string,
    extra: Record<string, unknown> = {},
  ): Parameters<typeof recordCollection>[0] {
    return {
      customerId,
      date: new Date(),
      method: "GCASH",
      reference: "DED-REF-1",
      checkBank: null,
      checkDate: null,
      receiptNo: null,
      amountReceived: "1000.00",
      notes: null,
      allocations: [],
      ...extra,
    } as Parameters<typeof recordCollection>[0];
  }

  it("new billings carry no withholding forecast", async () => {
    const year = await freshYear();
    const { billing } = await makeOpenBilling(year, "GOODS");
    const stored = await db.billing.findUniqueOrThrow({ where: { id: billing.id } });
    expect(money(stored.withholdingExpected)).toBe("0.00");
    expect(stored.withholdingBreakdown).toBeNull();
    expect(money(stored.netExpected)).toBe("1000.00");
  });

  it("SERVICES billing: staff record typed catalogue 2307 lines + a fee row and settle exactly", async () => {
    const year = await freshYear();
    const { customer, so, billing } = await makeOpenBilling(year, "SERVICES");
    const account = await makeAccount();

    // The SO carries no codes (new-model document): before this build a
    // non-admin could not record ANY 2307 line here. The certificate's
    // two catalogue lines (WI157 2% + WV010/WV020 5% — the catalogue stores
    // the VAT pair as one ATC string) must now record.
    const col = await recordCollection(
      collectionInput(customer.id, {
        cashAccountId: account.id,
        allocations: [
          {
            billingId: billing.id,
            cashApplied: "880.00",
            withholdingApplied: "120.00",
            codes: [
              { rate: "0.0200", atcCode: "WI157", amount: "70.00" },
              { rate: "0.0500", atcCode: "WV010/WV020", amount: "50.00" },
            ],
          },
        ],
        deductions: [{ kind: "FEE", amount: "30.00" }],
      }),
      staff,
    );

    // Settlement proof: applied 1,000 = cash 880 + withholding 120; the
    // billing is PAID by cash + withholding (the fee never settles it).
    const after = await db.billing.findUniqueOrThrow({ where: { id: billing.id } });
    expect(after.status).toBe("PAID");
    expect(money(after.withholdingExpected)).toBe("0.00");
    expect(after.withholdingBreakdown).toBeNull();

    // The 2307 record carries the two typed lines.
    const w = await db.withholding2307.findFirstOrThrow({
      where: { collectionId: col.id, billingId: billing.id },
      include: { lines: true },
    });
    expect(money(w.amount)).toBe("120.00");
    expect(w.lines.map((l) => `${l.atcCode}:${money(l.amount)}`).sort()).toEqual(["WI157:70.00", "WV010/WV020:50.00"]);

    // Deduction rows: one WITHHOLDING mirror (no expense, linked to the
    // 2307) + one FEE row (expense posted, legacy fields synced).
    const rows = await db.collectionDeduction.findMany({
      where: { collectionId: col.id },
      orderBy: { kind: "asc" },
    });
    expect(rows.map((r) => r.kind)).toEqual(["FEE", "WITHHOLDING"]);
    const feeRow = rows.find((r) => r.kind === "FEE")!;
    const whRow = rows.find((r) => r.kind === "WITHHOLDING")!;
    expect(money(feeRow.amount)).toBe("30.00");
    expect(feeRow.cashAffecting).toBe(true);
    expect(feeRow.expenseId).toBeTruthy();
    expect(money(whRow.amount)).toBe("120.00");
    expect(whRow.cashAffecting).toBe(false);
    expect(whRow.expenseId).toBeNull();
    expect(whRow.billingId).toBe(billing.id);
    expect(whRow.withholding2307Id).toBe(w.id);

    const stored = await db.collection.findUniqueOrThrow({ where: { id: col.id } });
    expect(money(stored.feeAmount)).toBe("30.00");
    expect(stored.feeExpenseId).toBe(feeRow.expenseId);
    const expense = await db.expense.findUniqueOrThrow({ where: { id: feeRow.expenseId! } });
    expect(expense.salesOrderId).toBe(so.id);
    expect(expense.notes).toBe(
      `Collection fee withheld from collection - collection ${col.number}, billing ${billing.number}.`,
    );

    // Account movement: 1,000 received − 30 fee = 970 (withholding never
    // posts an expense).
    expect(await cashAccountBalance(account.id)).toBe("970.00");
  });

  it("GOODS billing: OTHER rows split by cash effect — only the cash-affecting one posts an expense", async () => {
    const year = await freshYear();
    const { customer, billing } = await makeOpenBilling(year, "GOODS");
    const account = await makeAccount();

    const col = await recordCollection(
      collectionInput(customer.id, {
        cashAccountId: account.id,
        allocations: [{ billingId: billing.id, cashApplied: "1000.00", withholdingApplied: "0.00" }],
        deductions: [
          { kind: "OTHER", label: "Transfer charge", amount: "20.00", cashAffecting: true },
          { kind: "OTHER", label: "Short payment — damaged box", amount: "30.00", cashAffecting: false },
        ],
      }),
      admin,
    );

    const after = await db.billing.findUniqueOrThrow({ where: { id: billing.id } });
    expect(after.status).toBe("PAID");

    const rows = await db.collectionDeduction.findMany({ where: { collectionId: col.id } });
    expect(rows).toHaveLength(2);
    const cashRow = rows.find((r) => r.label === "Transfer charge")!;
    const settleRow = rows.find((r) => r.label === "Short payment — damaged box")!;
    expect(cashRow.cashAffecting).toBe(true);
    expect(cashRow.expenseId).toBeTruthy();
    expect(settleRow.cashAffecting).toBe(false);
    expect(settleRow.expenseId).toBeNull();

    const expense = await db.expense.findUniqueOrThrow({ where: { id: cashRow.expenseId! } });
    expect(money(expense.amount)).toBe("20.00");
    expect(expense.notes).toBe(
      `Collection deduction (Transfer charge) withheld from collection - collection ${col.number}, billing ${billing.number}.`,
    );
    expect(await db.expense.count({ where: { salesOrderId: billing.salesOrderId } })).toBe(1);

    // No FEE row → the legacy fee fields stay at their pre-fee values.
    const stored = await db.collection.findUniqueOrThrow({ where: { id: col.id } });
    expect(money(stored.feeAmount)).toBe("0.00");
    expect(stored.feeExpenseId).toBeNull();

    // Account movement: 1,000 − 20 (only the cash-affecting row) = 980.
    expect(await cashAccountBalance(account.id)).toBe("980.00");
  });

  it("over-deductions are refused and record nothing", async () => {
    const year = await freshYear();
    const { customer, billing } = await makeOpenBilling(year, "GOODS");
    const counts = async () => ({
      collections: await db.collection.count({ where: { customerId: customer.id } }),
      expenses: await db.expense.count(),
      deductions: await db.collectionDeduction.count(),
    });
    const before = await counts();

    // Rows above the amount received.
    await expect(
      recordCollection(
        collectionInput(customer.id, {
          allocations: [{ billingId: billing.id, cashApplied: "1000.00", withholdingApplied: "0.00" }],
          deductions: [
            { kind: "FEE", amount: "600.00" },
            { kind: "OTHER", label: "Charge", amount: "500.00" },
          ],
        }),
        admin,
      ),
    ).rejects.toThrow(/can't be more than the amount received/);

    // Withholding + fee above the amount applied (cash would go negative).
    await expect(
      recordCollection(
        collectionInput(customer.id, {
          allocations: [
            {
              billingId: billing.id,
              cashApplied: "100.00",
              withholdingApplied: "900.00",
              codes: [{ rate: "0.0100", atcCode: "WI640", amount: "900.00" }],
            },
          ],
          deductions: [{ kind: "FEE", amount: "200.00" }],
        }),
        admin,
      ),
    ).rejects.toThrow(/amount applied/);

    expect(await counts()).toEqual(before);
  });

  it("an OTHER row with no label is refused and records nothing", async () => {
    const year = await freshYear();
    const { customer, billing } = await makeOpenBilling(year, "GOODS");
    const before = await db.collection.count({ where: { customerId: customer.id } });
    await expect(
      recordCollection(
        collectionInput(customer.id, {
          allocations: [{ billingId: billing.id, cashApplied: "1000.00", withholdingApplied: "0.00" }],
          deductions: [{ kind: "OTHER", amount: "10.00" }],
        }),
        admin,
      ),
    ).rejects.toThrow(/label/);
    expect(await db.collection.count({ where: { customerId: customer.id } })).toBe(before);
  });

  it("voiding reverses every row: both expenses VOID, the account restored, the billing reopened", async () => {
    const year = await freshYear();
    const { customer, billing } = await makeOpenBilling(year, "GOODS");
    const account = await makeAccount();
    const col = await recordCollection(
      collectionInput(customer.id, {
        cashAccountId: account.id,
        allocations: [
          {
            billingId: billing.id,
            cashApplied: "900.00",
            withholdingApplied: "100.00",
            codes: [{ rate: "0.0100", atcCode: "WI640", amount: "100.00" }],
          },
        ],
        deductions: [
          { kind: "FEE", amount: "40.00" },
          { kind: "OTHER", label: "Transfer charge", amount: "10.00", cashAffecting: true },
          { kind: "OTHER", label: "Short payment", amount: "5.00", cashAffecting: false },
        ],
      }),
      admin,
    );
    expect(await cashAccountBalance(account.id)).toBe("950.00");
    expect((await db.billing.findUniqueOrThrow({ where: { id: billing.id } })).status).toBe("PAID");

    await voidCollection(col.id, "Recorded against the wrong payment.", admin);

    const rows = await db.collectionDeduction.findMany({ where: { collectionId: col.id } });
    expect(rows.map((r) => r.kind).sort()).toEqual(["FEE", "OTHER", "OTHER", "WITHHOLDING"]);
    const expenseIds = rows.filter((r) => r.expenseId).map((r) => r.expenseId!);
    expect(expenseIds).toHaveLength(2);
    for (const id of expenseIds) {
      const e = await db.expense.findUniqueOrThrow({ where: { id } });
      expect(e.status).toBe("VOID");
      expect(e.voidReason).toContain(`Voided with collection ${col.number}`);
    }
    expect(await cashAccountBalance(account.id)).toBe("0.00");
    expect((await db.billing.findUniqueOrThrow({ where: { id: billing.id } })).status).toBe("OPEN");
    // The pending 2307 is soft-cleared, as before.
    const w = await db.withholding2307.findFirstOrThrow({ where: { collectionId: col.id } });
    expect(money(w.amount)).toBe("0.00");
  });

  it("a stored (pre-retirement) billing keeps its stored prefill and collects by typed 2307 as before", async () => {
    const year = await freshYear();
    const { customer, billing } = await makeOpenBilling(year, "GOODS");
    // Simulate an issued pre-retirement billing: stored forecast + split.
    await db.billing.update({
      where: { id: billing.id },
      data: {
        withholdingExpected: "40.00",
        withholdingBreakdown: [{ rate: "0.0100", atcCode: "WI640", amount: "40.00" }],
        netExpected: "960.00",
      },
    });

    // Prefill still pro-rates the STORED breakdown (stored behaviour
    // identical — the retirement only touches new documents).
    const prefill = await withholdingCodePrefill(db, billing.id);
    expect(prefill).toEqual([{ rate: "0.0100", atcCode: "WI640", amount: "40.00" }]);

    await recordCollection(
      collectionInput(customer.id, {
        allocations: [
          {
            billingId: billing.id,
            cashApplied: "960.00",
            withholdingApplied: "40.00",
            codes: [{ rate: "0.0100", atcCode: "WI640", amount: "40.00" }],
          },
        ],
      }),
      admin,
    );
    const after = await db.billing.findUniqueOrThrow({ where: { id: billing.id } });
    expect(after.status).toBe("PAID");
    // The stored forecast figures were never rewritten by the collection.
    expect(money(after.withholdingExpected)).toBe("40.00");
    expect(money(after.netExpected)).toBe("960.00");
  });

  it("customer-default hint: prefill lends bare codes (blank amounts) when the SO has none", async () => {
    const year = await freshYear();
    const { customer, billing } = await makeOpenBilling(year, "GOODS");
    // The default is saved after the order exists: the SO snapshot stays
    // empty, so only the hint can lend codes — codes only, never amounts.
    await db.customer.update({
      where: { id: customer.id },
      data: { defaultWithholding: ["GOODS_1"] },
    });
    const prefill = await withholdingCodePrefill(db, billing.id);
    expect(prefill).toEqual([{ rate: "0.0100", atcCode: "WI158", amount: "" }]);
  });

  it("cost margin: a new-model SO derives net received from actual withheld; a stored snapshot is untouched", async () => {
    const year = await freshYear();
    const { customer, so, billing } = await makeOpenBilling(year, "GOODS");

    const before = await getSoCostMargin(so.id, admin);
    expect(before?.withholdingTotal).toBe("0.00");
    expect(before?.afterWithholding.netReceived).toBe("1000.00");

    await recordCollection(
      collectionInput(customer.id, {
        allocations: [
          {
            billingId: billing.id,
            cashApplied: "880.00",
            withholdingApplied: "120.00",
            codes: [{ rate: "0.0100", atcCode: "WI640", amount: "120.00" }],
          },
        ],
      }),
      admin,
    );
    const after = await getSoCostMargin(so.id, admin);
    expect(after?.withholdingTotal).toBe("120.00");
    expect(after?.afterWithholding.netReceived).toBe("880.00");

    // An SO with a stored snapshot keeps its stored figure even with no
    // collections at all.
    const legacy = await makeOpenBilling(year, "GOODS");
    await db.salesOrder.update({
      where: { id: legacy.so.id },
      data: {
        withholding: [
          { code: "GOV_GOODS_1", label: "Gov goods 1%", lineKind: "GOODS", rate: "0.0100", atcCode: "WI640" },
        ],
        withholdingTotal: "40.00",
      },
    });
    const legacySummary = await getSoCostMargin(legacy.so.id, admin);
    expect(legacySummary?.withholdingTotal).toBe("40.00");
    expect(legacySummary?.afterWithholding.netReceived).toBe("960.00");
  });
});
