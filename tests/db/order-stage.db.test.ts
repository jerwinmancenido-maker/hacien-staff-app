// ERP adoption item 15: the derived SO stage label, end to end — the SO
// list view's item-7 progress measures feed salesOrderStage and every
// fixture lands on the stage its documents say it should. Rows are created
// directly (the views only read), with amounts chosen so every percentage
// is checkable by hand. VOID orders carry no progress and no stage.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env["DATABASE" + "_URL"] = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { getSettingsSnapshot } from "@/lib/settings";
import { listSalesOrdersPageView } from "@/lib/quotes/views";
import { salesOrderStage } from "@/lib/progress";
import { freshYear, makeCustomer, makeUser, tag } from "./fixtures";
import type { DocActor } from "@/lib/services/quotes";

const DAY = new Date(Date.UTC(2026, 0, 15));

describe.skipIf(!env.hasDb)("sales order stage label (MySQL)", () => {
  let admin: DocActor;
  let settingsVersionId: string;
  const run = tag();
  const soAwaiting = `SO-STAGE-${run}-A`;
  const soPartPaid = `SO-STAGE-${run}-P`;
  const soPaidFull = `SO-STAGE-${run}-F`;
  const soPrepaid = `SO-STAGE-${run}-R`;
  const soClosed = `SO-STAGE-${run}-C`;
  const soVoid = `SO-STAGE-${run}-V`;
  const soZero = `SO-STAGE-${run}-Z`;
  let invoiceSeq = 0;

  beforeAll(async () => {
    admin = await makeUser("costs");
    settingsVersionId = (await getSettingsSnapshot()).versionId;
    const customer = await makeCustomer();
    await freshYear();
    invoiceSeq = 920_000 + Math.floor(Math.random() * 50_000);

    const mkSo = async (number: string, status: "OPEN" | "CLOSED" | "VOID", contractPrice: string) =>
      db.salesOrder.create({
        data: {
          number,
          customerId: customer.id,
          date: DAY,
          status,
          settingsVersionId,
          withholding: [],
          contractPrice,
          createdById: admin.id,
          updatedById: admin.id,
        },
      });
    const mkLines = async (salesOrderId: string, qty: string, deliveredQty: string) =>
      db.salesOrderItem.create({
        data: {
          salesOrderId,
          sortOrder: 0,
          description: "Line 1",
          kind: "GOODS",
          qty,
          unit: "pc",
          unitPrice: "100.00",
          total: "100.00",
          deliveredQty,
        },
      });
    const mkBilling = async (salesOrderId: string, number: string, amount: string) =>
      db.billing.create({
        data: {
          number,
          salesOrderId,
          customerId: customer.id,
          invoiceNo: ++invoiceSeq,
          invoiceDate: DAY,
          dueDate: DAY,
          amount,
          netExpected: amount,
          status: "OPEN",
          createdById: admin.id,
          updatedById: admin.id,
        },
      });
    const mkCollection = async (number: string, billingId: string, cash: string) => {
      const col = await db.collection.create({
        data: { number, customerId: customer.id, date: DAY, method: "CASH", amountReceived: cash, status: "POSTED", createdById: admin.id },
      });
      await db.collectionAllocation.create({
        data: { collectionId: col.id, billingId, cashApplied: cash, withholdingApplied: "0.00" },
      });
    };

    // A: delivered + billed in full, nothing paid → Billed, awaiting payment.
    const soA = await mkSo(soAwaiting, "OPEN", "1000.00");
    await mkLines(soA.id, "10.00", "10.00");
    await mkBilling(soA.id, `BL-STAGE-${run}-A`, "1000.00");

    // P: delivered + billed in full, 400 of 1000 paid → Part-paid.
    const soP = await mkSo(soPartPaid, "OPEN", "1000.00");
    await mkLines(soP.id, "10.00", "10.00");
    const blP = await mkBilling(soP.id, `BL-STAGE-${run}-P`, "1000.00");
    await mkCollection(`CR-STAGE-${run}-P`, blP.id, "400.00");

    // F: delivered, billed and paid in full → Paid in full.
    const soF = await mkSo(soPaidFull, "OPEN", "500.00");
    await mkLines(soF.id, "2.00", "2.00");
    const blF = await mkBilling(soF.id, `BL-STAGE-${run}-F`, "500.00");
    await mkCollection(`CR-STAGE-${run}-F`, blF.id, "500.00");

    // R: billed + paid in full, nothing delivered → Not yet delivered
    // (the money ran ahead; the goods are still owed, so delivery wins).
    const soR = await mkSo(soPrepaid, "OPEN", "1000.00");
    await mkLines(soR.id, "10.00", "0.00");
    const blR = await mkBilling(soR.id, `BL-STAGE-${run}-R`, "1000.00");
    await mkCollection(`CR-STAGE-${run}-R`, blR.id, "1000.00");

    // C: closed short of full payment → Closed (the status wins).
    const soC = await mkSo(soClosed, "CLOSED", "1000.00");
    await mkLines(soC.id, "10.00", "4.00");
    await mkBilling(soC.id, `BL-STAGE-${run}-C`, "400.00");

    // V: void → progress null, no stage.
    const soV = await mkSo(soVoid, "VOID", "1000.00");
    await mkLines(soV.id, "2.00", "2.00");

    // Z: ₱0, no lines, no billings → every measure baseless → Nothing outstanding.
    await mkSo(soZero, "OPEN", "0.00");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("list rows carry the measures each stage is derived from", async () => {
    const page = await listSalesOrdersPageView({ q: `SO-STAGE-${run}` }, 1, 50);
    const byNumber = new Map(page.items.map((r) => [r.number, r]));
    expect(byNumber.get(soAwaiting)?.progress).toEqual({ deliveredPct: 100, billedPct: 100, paidPct: 0 });
    expect(byNumber.get(soPartPaid)?.progress).toEqual({ deliveredPct: 100, billedPct: 100, paidPct: 40 });
    expect(byNumber.get(soPaidFull)?.progress).toEqual({ deliveredPct: 100, billedPct: 100, paidPct: 100 });
    expect(byNumber.get(soPrepaid)?.progress).toEqual({ deliveredPct: 0, billedPct: 100, paidPct: 100 });
    expect(byNumber.get(soVoid)?.progress).toBeNull();
    expect(byNumber.get(soZero)?.progress).toEqual({ deliveredPct: null, billedPct: null, paidPct: null });
  });

  it("each fixture row derives the stage its documents describe", async () => {
    const page = await listSalesOrdersPageView({ q: `SO-STAGE-${run}` }, 1, 50);
    const stageOf = (number: string) => {
      const row = page.items.find((r) => r.number === number);
      if (!row?.progress) return null;
      return salesOrderStage(row.status, row.progress);
    };
    expect(stageOf(soAwaiting)).toBe("Billed, awaiting payment");
    expect(stageOf(soPartPaid)).toBe("Part-paid");
    expect(stageOf(soPaidFull)).toBe("Paid in full");
    expect(stageOf(soPrepaid)).toBe("Not yet delivered");
    expect(stageOf(soClosed)).toBe("Closed");
    expect(stageOf(soVoid)).toBeNull();
    expect(stageOf(soZero)).toBe("Nothing outstanding");
  });
});
